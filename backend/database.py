# backend/database.py

import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv() # Load environment variables from a .env file

# --- MongoDB Connection ---
# It's highly recommended to store your MONGO_URI in a .env file
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = "forwardicbot_db"

client = AsyncIOMotorClient(MONGO_URI)
db = client[DB_NAME]

# --- Collections ---
# We define our collections here for easy access throughout the app
users_collection = db.get_collection("users")
accounts_collection = db.get_collection("accounts")
plans_collection = db.get_collection("plans")
forwarding_rules_collection = db.get_collection("forwarding_rules")
auto_reply_settings_collection = db.get_collection("auto_reply_settings")
smart_selling_settings_collection = db.get_collection("smart_selling_settings")