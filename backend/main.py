# backend/main.py

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request, Response, status, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from contextlib import asynccontextmanager
from pydantic import BaseModel, Field
from typing import List, Optional
import asyncio
from datetime import datetime, timedelta
from bson import ObjectId

from backend.bot import ptb_app
from .logger import log_broadcaster 
from .worker import WorkerManager
from fastapi.security import OAuth2PasswordRequestForm

from backend.auth import get_current_admin_user, get_user_from_cookie 
from backend.database import (
    users_collection, accounts_collection, plans_collection, 
    forwarding_rules_collection, auto_reply_settings_collection,
    smart_selling_settings_collection
)

# Pydantic model for validating incoming rule data
class ForwardingRule(BaseModel):
    account_phone: str
    source_chat: str
    destination_chat: str
    filters: str | None = None

class GroupJoinRequest(BaseModel):
    account_phone: str
    group_links: List[str]

class AutoReplySettings(BaseModel):
    account_phone: str
    message: str
    keywords: Optional[str] = None

class LinkValidationRequest(BaseModel):
    link: str

class ExtractionRequest(BaseModel):
    account_phone: str
    channel_link: str
    extract_type: str
    limit: int = 100 # Default limit

class ForwardingJobRequest(BaseModel):
    account_phone: str
    message_link: str
    delay: int = 0
    cycle_delay: int = 5
    targets: List[str]
    hide_sender: bool = False

class SmartSellingSettings(BaseModel):
    account_phone: str
    enabled: bool
    must_contain: Optional[str] = None
    maybe_contain: Optional[str] = None
    message: str

class Plan(BaseModel):
    name: str
    price: float
    duration_days: int

class UserSubscription(BaseModel):
    plan_id: str

from backend.auth import (
    User, get_current_user, get_password_hash, verify_password,
    create_access_token, ACCESS_TOKEN_EXPIRE_MINUTES
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 Server starting up...")
    
    # Start the worker manager to activate forwarding
    app.state.worker_manager = WorkerManager(logger=log_broadcaster)
    await app.state.worker_manager.startup()

    await ptb_app.initialize()
    await ptb_app.start()
    if ptb_app.post_init:
        await ptb_app.post_init(ptb_app)
    print("✅ PTB application started.")
    app.state.static_files = static_files_app
    yield
    print("🛑 Server shutting down...")
    await ptb_app.stop()
    print("✅ PTB application stopped.")

app = FastAPI(lifespan=lifespan)

# --- WebSocket & API Endpoints ---

@app.get("/")
async def read_root(request: Request):
    """
    Acts as a gatekeeper for the root URL. It checks the user's role
    and serves the correct starting page (landing, user dashboard, or admin panel).
    """
    token = request.cookies.get("access_token")
    try:
        if token:
            user = await get_current_user(request)
            if user.role == 'admin':
                return FileResponse('frontend/admin.html')
            else:
                return FileResponse('frontend/index.html')
    except HTTPException:
        # This catches invalid or expired tokens
        pass
    
    # For any non-logged-in user or user with an invalid token
    return FileResponse('frontend/landing.html')

@app.websocket("/ws/add_account")
async def websocket_add_account(websocket: WebSocket):
    await websocket.accept()
    worker_manager = websocket.app.state.worker_manager
    try:
        await worker_manager.start_interactive_session(websocket)
    except WebSocketDisconnect:
        print("Client disconnected during login process.")

@app.get("/api/accounts")
async def get_accounts(request: Request, current_user: User = Depends(get_current_user)):
    """
    Returns a list of accounts with their TRUE LIVE status.
    """
    worker_manager: WorkerManager = request.app.state.worker_manager
    live_clients = worker_manager.clients.keys()
    accounts = []
    async for account in accounts_collection.find({}):
        account['_id'] = str(account['_id'])  # Convert ObjectId to string
        account['status'] = "Online" if account['phone'] in live_clients else "Offline"
        accounts.append(account)
    return accounts

@app.delete("/api/accounts/{phone}")
async def delete_account(phone: str, current_user: User = Depends(get_current_user)):
    result = await accounts_collection.delete_one({"phone": phone})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Account not found")
    return {"status": "success"}

@app.post("/api/register")
async def register_user(form_data: OAuth2PasswordRequestForm = Depends()):
    user = await users_collection.find_one({"username": form_data.username})
    if user:
        raise HTTPException(status_code=400, detail="Username already registered")
    
    hashed_password = get_password_hash(form_data.password)
    # New users are always given the 'user' role for security
    await users_collection.insert_one({
        "username": form_data.username,
        "hashed_password": hashed_password,
        "role": "user",
        "created_at": datetime.utcnow()
    })
    return {"message": "User registered successfully"}

@app.post("/api/token")
async def login_for_access_token(response: Response, form_data: OAuth2PasswordRequestForm = Depends()):
    user = await users_collection.find_one({"username": form_data.username})
    if not user or not verify_password(form_data.password, user['hashed_password']):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user['username']}, expires_delta=access_token_expires
    )
    
    # Set the token in an HTTP-only cookie
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        expires=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        samesite="lax",
        secure=False  # Set to True in production with HTTPS
    )
    
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/users/me", response_model=User)
async def read_users_me(current_user: User = Depends(get_current_user)):
    """An endpoint to verify if a user is logged in and get their data."""
    return current_user

@app.post("/api/logout")
async def logout(response: Response, current_user: User = Depends(get_current_user)):
    response.delete_cookie(key="access_token")
    return {"message": "Logout successful"}

# --- Forwarding Rules Endpoints ---

@app.get("/api/rules/forwarding")
async def get_forwarding_rules(current_user: User = Depends(get_current_user)):
    """Gets all forwarding rules from the database."""
    rules = []
    async for rule in forwarding_rules_collection.find({}):
        rule['_id'] = str(rule['_id'])  # Convert ObjectId to string
        rules.append(rule)
    return rules

@app.post("/api/rules/forwarding")
async def add_forwarding_rule(rule: ForwardingRule, current_user: User = Depends(get_current_user)):
    """Adds a new forwarding rule to the database."""
    try:
        rule_doc = {
            "account_phone": rule.account_phone,
            "source_chat": rule.source_chat,
            "destination_chat": rule.destination_chat,
            "filters": rule.filters,
            "status": "active",  # Default status
            "created_at": datetime.utcnow()
        }
        
        result = await forwarding_rules_collection.insert_one(rule_doc)
        print(f"✅ Rule added: {rule.source_chat} -> {rule.destination_chat}")
        return {"status": "success", "message": "Rule added successfully", "id": str(result.inserted_id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/rules/forwarding/{rule_id}")
async def delete_forwarding_rule(rule_id: str, current_user: User = Depends(get_current_user)):
    """Deletes a forwarding rule."""
    try:
        result = await forwarding_rules_collection.delete_one({"_id": ObjectId(rule_id)})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Rule not found")
        return {"status": "success", "message": "Rule deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/joiner/join_groups")
async def join_groups(request: GroupJoinRequest, current_user: User = Depends(get_current_user)):
    """
    Receives a request and tells the appropriate worker to join groups.
    """
    worker_manager: WorkerManager = app.state.worker_manager
    print(f"Received request for {request.account_phone} to join {len(request.group_links)} groups.")
    
    results = await worker_manager.join_groups_for_account(
        phone=request.account_phone,
        group_links=request.group_links
    )
    
    return {"status": "completed", "results": results}

# --- Auto Reply Settings Endpoints ---

@app.get("/api/settings/auto_reply/{phone}")
async def get_auto_reply_settings(phone: str, current_user: User = Depends(get_current_user)):
    """Gets the auto-reply settings for a specific account."""
    settings = await auto_reply_settings_collection.find_one({"account_phone": phone})
    if not settings:
        return {"message": "", "keywords": ""}
    return {"message": settings.get("message", ""), "keywords": settings.get("keywords", "")}

@app.post("/api/settings/auto_reply")
async def set_auto_reply_settings(settings: AutoReplySettings, current_user: User = Depends(get_current_user)):
    """Saves or updates the auto-reply settings for an account."""
    try:
        settings_doc = {
            "account_phone": settings.account_phone,
            "message": settings.message,
            "keywords": settings.keywords,
            "updated_at": datetime.utcnow()
        }
        
        await auto_reply_settings_collection.replace_one(
            {"account_phone": settings.account_phone},
            settings_doc,
            upsert=True
        )
        
        print(f"✅ Auto-reply settings updated for {settings.account_phone}")
        return {"status": "success", "message": "Settings saved successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Link Validator Endpoint ---

@app.post("/api/validator/validate_link")
async def validate_link(request: LinkValidationRequest, current_user: User = Depends(get_current_user)):
    """
    Receives a link from the frontend and asks the worker to validate it.
    """
    worker_manager: WorkerManager = app.state.worker_manager
    result = await worker_manager.validate_telegram_link(link=request.link)
    return result

# --- Link Extractor Endpoint ---

@app.post("/api/extractor/extract")
async def extract_data(request: ExtractionRequest, current_user: User = Depends(get_current_user)):
    """
    Receives an extraction request and asks the worker to perform it.
    """
    worker_manager: WorkerManager = app.state.worker_manager
    result = await worker_manager.extract_from_channel(
        phone=request.account_phone,
        channel_link=request.channel_link,
        extract_type=request.extract_type,
        limit=request.limit
    )
    return result

# --- Forward Config Job Endpoint ---

@app.post("/api/forwarder/start_forwarding")
async def start_single_forwarding(request: ForwardingJobRequest, current_user: User = Depends(get_current_user)):
    """
    Receives a single message forwarding job and asks the worker to execute it.
    """
    worker_manager: WorkerManager = app.state.worker_manager
    result = await worker_manager.start_forwarding_job(
        phone=request.account_phone,
        message_link=request.message_link,
        delay=request.delay,
        cycle_delay=request.cycle_delay,
        targets=request.targets,
        hide_sender=request.hide_sender
    )
    return result

# --- Smart Selling Settings Endpoints ---

@app.get("/api/settings/smart_selling/{phone}")
async def get_smart_selling_settings(phone: str, current_user: User = Depends(get_current_user)):
    """Gets the smart selling settings for a specific account."""
    settings = await smart_selling_settings_collection.find_one({"account_phone": phone})
    if not settings:
        return {"enabled": False, "must_contain": "", "maybe_contain": "", "message": ""}
    return {
        "enabled": settings.get("enabled", False),
        "must_contain": settings.get("must_contain", ""),
        "maybe_contain": settings.get("maybe_contain", ""),
        "message": settings.get("message", "")
    }

@app.post("/api/settings/smart_selling")
async def set_smart_selling_settings(settings: SmartSellingSettings, current_user: User = Depends(get_current_user)):
    """Saves or updates the smart selling settings for an account."""
    try:
        settings_doc = {
            "account_phone": settings.account_phone,
            "enabled": settings.enabled,
            "must_contain": settings.must_contain,
            "maybe_contain": settings.maybe_contain,
            "message": settings.message,
            "updated_at": datetime.utcnow()
        }
        
        await smart_selling_settings_collection.replace_one(
            {"account_phone": settings.account_phone},
            settings_doc,
            upsert=True
        )
        
        print(f"✅ Smart Selling settings updated for {settings.account_phone}")
        return {"status": "success", "message": "Configuration saved successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Live Logs WebSocket ---

@app.websocket("/ws/logs")
async def websocket_logs(websocket: WebSocket):
    await log_broadcaster.connect(websocket)
    try:
        while True:
            # Keep the connection alive
            await asyncio.sleep(60)
    except WebSocketDisconnect:
        log_broadcaster.disconnect(websocket)
    finally:
        if websocket in log_broadcaster.connections:
            log_broadcaster.disconnect(websocket)

# --- Public Pricing Plans Endpoint ---

@app.get("/api/plans")
async def get_plans():
    """Public endpoint to fetch pricing plans for the landing page."""
    plans = []
    async for plan in plans_collection.find({}):
        plan['_id'] = str(plan['_id'])  # Convert ObjectId to string
        plans.append(plan)
    return plans

# --- Admin Endpoints ---

@app.get("/api/admin/users")
async def admin_get_users(current_user: User = Depends(get_current_admin_user)):
    """Admin-only endpoint to get all user data."""
    users = []
    async for user in users_collection.find({}):
        user['_id'] = str(user['_id'])  # Convert ObjectId to string
        # Don't return password hash
        user.pop('hashed_password', None)
        users.append(user)
    return users

@app.post("/api/admin/plans", status_code=status.HTTP_201_CREATED)
async def admin_create_plan(plan: Plan, current_user: User = Depends(get_current_admin_user)):
    """Admin: Creates a new pricing plan."""
    plan_doc = {
        "name": plan.name,
        "price": plan.price,
        "duration_days": plan.duration_days,
        "created_at": datetime.utcnow()
    }
    
    result = await plans_collection.insert_one(plan_doc)
    return {"status": "success", "message": "Plan created successfully.", "id": str(result.inserted_id)}

@app.put("/api/admin/plans/{plan_id}")
async def admin_update_plan(plan_id: str, plan: Plan, current_user: User = Depends(get_current_admin_user)):
    """Admin: Updates an existing pricing plan."""
    try:
        plan_doc = {
            "name": plan.name,
            "price": plan.price,
            "duration_days": plan.duration_days,
            "updated_at": datetime.utcnow()
        }
        
        result = await plans_collection.update_one(
            {"_id": ObjectId(plan_id)},
            {"$set": plan_doc}
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Plan not found")
            
        return {"status": "success", "message": "Plan updated successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/admin/plans/{plan_id}")
async def admin_delete_plan(plan_id: str, current_user: User = Depends(get_current_admin_user)):
    """Admin: Deletes a pricing plan."""
    try:
        result = await plans_collection.delete_one({"_id": ObjectId(plan_id)})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Plan not found")
        return {"status": "success", "message": "Plan deleted successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/admin/users/{username}/subscription")
async def admin_grant_subscription(username: str, subscription: UserSubscription, current_user: User = Depends(get_current_admin_user)):
    """Admin: Grants or updates a user's subscription."""
    try:
        # First, get the plan's duration
        plan = await plans_collection.find_one({"_id": ObjectId(subscription.plan_id)})
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")
        
        # Calculate the end date
        end_date = datetime.utcnow() + timedelta(days=plan['duration_days'])
        
        # Update the user
        result = await users_collection.update_one(
            {"username": username},
            {
                "$set": {
                    "plan_id": subscription.plan_id,
                    "subscription_end_date": end_date,
                    "updated_at": datetime.utcnow()
                }
            }
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="User not found")
            
        return {"status": "success", "message": f"Subscription granted to {username}."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/admin/users/{username}")
async def admin_delete_user(username: str, current_user: User = Depends(get_current_admin_user)):
    """Admin: Deletes a user."""
    try:
        result = await users_collection.delete_one({"username": username})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="User not found")
        return {"status": "success", "message": "User deleted successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Serve Frontend ---
static_files_app = StaticFiles(directory="frontend", html=True)
app.mount("/", static_files_app, name="static")