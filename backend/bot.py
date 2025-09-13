# backend/bot.py

from telegram import Update, WebAppInfo, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, ContextTypes

# --- Configuration ---
# ⚠️ Replace with your actual Bot Token from @BotFather
BOT_TOKEN = "6355641479:AAFB6QlUKNOBcYzUD0bf2sb1okfi1MJsTlw"

# This should be the address where your FastAPI server is running
# For local development, this is correct.
WEB_APP_URL = "http://127.0.0.1:8000"

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Sends a welcome message with a button to launch the web app dashboard.
    """
    keyboard = [
        [InlineKeyboardButton("🚀 Open Dashboard", web_app=WebAppInfo(url=WEB_APP_URL))]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await update.message.reply_text(
        'Welcome! Click the button below to open your management dashboard.',
        reply_markup=reply_markup
    )

# --- PTB Application Setup ---
# We create the Application instance here, which will be imported and run by main.py
ptb_app = Application.builder().token(BOT_TOKEN).build()

# Add the /start command handler
ptb_app.add_handler(CommandHandler("start", start))