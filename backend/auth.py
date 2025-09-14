# backend/auth.py

import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from fastapi import WebSocket, Depends, Query
from passlib.context import CryptContext
from pydantic import BaseModel
from .database import users_collection
DATABASE_FILE = "dashboard.db"

# --- Configuration ---
# In a real app, load this from a .env file
SECRET_KEY = "a_very_secret_key_for_jwt_that_should_be_long_and_random"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 # 1 day

# Password Hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# --- Pydantic Models ---
class User(BaseModel):
    username: str
    role: str
    hashed_password: Optional[str] = None # Add this field

class TokenData(BaseModel):
    username: Optional[str] = None

# --- Core Auth Functions ---
def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

# In backend/auth.py

async def get_current_user(request: Request):
    """
    Dependency to get the current user from the token in the cookie.
    This will be used to protect our API endpoints.
    """
    token = request.cookies.get("access_token")
    print(f"[AUTH DEBUG] Token found in cookie: {token is not None}")
        
    if not token:
        print("[AUTH DEBUG] No token found, raising 401")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username)
        user = await get_user_from_db(username=token_data.username)
        print(f"[AUTH DEBUG] User found: {user is not None}")
        if user is None:
            print("[AUTH DEBUG] User not found in database")
            raise credentials_exception
        print(f"[AUTH DEBUG] Authentication successful for user: {user.username}, role: {user.role}")
        return user

    except JWTError:
        raise credentials_exception

async def get_user_from_cookie(request: Request):
    print(f"[AUTH DEBUG] get_user_from_cookie called")
    print(f"[AUTH DEBUG] Request cookies: {dict(request.cookies)}")
    
    token = request.cookies.get("access_token")
    print(f"[AUTH DEBUG] Token found in cookie: {token is not None}")
    
    if not token:
        print("[AUTH DEBUG] No token found, raising 401")
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    try:
        print("[AUTH DEBUG] Attempting to decode JWT token")
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        print(f"[AUTH DEBUG] Extracted username from token: {username}")
        
        if username is None:
            print("[AUTH DEBUG] No username in token payload")
            raise HTTPException(status_code=401, detail="Invalid token")
            
    except JWTError as e:
        print(f"[AUTH DEBUG] JWT Error: {e}")
        raise HTTPException(status_code=401, detail="Invalid token")
    
    print(f"[AUTH DEBUG] Connecting to database for user lookup: {username}")
    conn = sqlite3.connect(DATABASE_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT username, role FROM users WHERE username = ?", (username,))
    user_data = cursor.fetchone()
    conn.close()

    print(f"[AUTH DEBUG] Database query result: {user_data}")
    
    if not user_data:
        print("[AUTH DEBUG] User not found in database")
        raise HTTPException(status_code=401, detail="User not found")
    
    user = User(username=user_data["username"], role=user_data["role"])
    print(f"[AUTH DEBUG] Cookie authentication successful for user: {user.username}, role: {user.role}")
    return user

async def get_current_admin_user(current_user: User = Depends(get_current_user)):
    """
    A dependency that checks if the current user is an admin.
    """
    print(f"[AUTH DEBUG] get_current_admin_user called for user: {current_user.username}, role: {current_user.role}")
    
    if current_user.role != "admin":
        print(f"[AUTH DEBUG] Access denied - user is not admin")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access this resource."
        )
    
    print(f"[AUTH DEBUG] Admin access granted for user: {current_user.username}")
    return current_user


async def get_user_from_db(username: str):
    """Fetches a user from the MongoDB 'users' collection."""
    user_data = await users_collection.find_one({"username": username})
    if user_data:
        # Pydantic's User model can be created directly from the dictionary
        return User(**user_data)
    return None

async def get_current_user_from_ws(
    websocket: WebSocket,
    token: str = Query(...)
):
    """
    Dependency to get the current user from a token in the WebSocket's query params.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username)
    except JWTError:
        raise credentials_exception
    
    user = await get_user_from_db(username=token_data.username)
    if user is None:
        raise credentials_exception
    return user