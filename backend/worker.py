# backend/worker.py
import asyncio
from datetime import datetime
from telethon import TelegramClient, events
from telethon.errors import SessionPasswordNeededError
from telethon.tl.functions.channels import JoinChannelRequest
from telethon.errors import SessionPasswordNeededError, UserAlreadyParticipantError
from telethon.sessions import StringSession
from telethon.tl.types import Channel, User
from fastapi import WebSocket
import re
import os
from dotenv import load_dotenv
from .logger import LogBroadcaster
from .database import (
    accounts_collection, forwarding_rules_collection, 
    auto_reply_settings_collection, smart_selling_settings_collection
)

# --- Configuration ---
load_dotenv()
API_ID = int(os.environ.get("API_ID", "0"))
API_HASH = os.environ.get("API_HASH", "")

class WorkerManager:
    def __init__(self, logger: LogBroadcaster):
        self.clients = {} # Holds running client instances, keyed by phone
        self.sessions_path = "sessions/"
        self.logger = logger # Store the logger instance

    async def startup(self):
        """
        This is the new startup method called by main.py.
        It loads all accounts from the DB and starts a client for each one.
        """
        await self.logger.log("🤖 WorkerManager starting up...")
        
        async for account in accounts_collection.find({"status": "Online"}):
            await self.logger.log(f"   -> Launching client for {account['phone']}")
            # Run each client in its own background task
            asyncio.create_task(self._run_client(account['phone'], account['session_string']))

    async def _update_account_status(self, phone: str, status: str):
        """A helper function to update the status in the database."""
        try:
            await accounts_collection.update_one(
                {"phone": phone},
                {"$set": {"status": status, "updated_at": datetime.utcnow()}}
            )
            print(f"   -> DB status for {phone} updated to {status}.")
        except Exception as e:
            print(f"   -> DB status update failed for {phone}: {e}")

    async def _run_client(self, phone: str, session_string: str):
        """
        Connects a single client, loads its rules, and runs until disconnected.
        """
        client = TelegramClient(StringSession(session_string), API_ID, API_HASH)
        
        try:
            await client.start(phone=phone)
            self.clients[phone] = client

            await accounts_collection.update_one({"phone": phone}, {"$set": {"status": "Online"}})
            await self.logger.log(f"✅ Client for {phone} connected and status set to Online.")

            # Load forwarding rules for this specific account
            rules = []
            async for rule in forwarding_rules_collection.find({
                "account_phone": phone, 
                "status": {"$in": ["Active", "active"]}
            }):
                rules.append(rule)
            
            if not rules:
                await self.logger.log(f"   -> No active rules for {phone}.")
                # Keep client alive but with no handlers, or disconnect
                # For now, we'll keep it running in case rules are added later.
            else:
                # Get a list of unique source chats to listen to
                source_chat_ids = list(set(
                    int(rule['source_chat']) 
                    for rule in rules 
                    if str(rule['source_chat']).lstrip('-').isdigit()
                ))
                await self.logger.log(f"   -> {phone} is listening to {len(source_chat_ids)} source chats.")

                @client.on(events.NewMessage(chats=source_chat_ids))
                async def handler(event):
                    # This handler will be specific to this client
                    await self.logger.log(f"   -> New message in {event.chat_id} for client {phone}")
                    await self.logger.log(f"[FORWARD] New message in {event.chat_id} for client {phone}")
                    for rule in rules:
                        if int(rule['source_chat']) == event.chat_id:
                            # TODO: Add filter/keyword logic here
                            try:
                                dest_id = int(rule['destination_chat'])
                                await event.forward_to(dest_id)
                                await self.logger.log(f"      -> Forwarded from {event.chat_id} to {dest_id}")
                                await self.logger.log(f"   -> Forwarded from {event.chat_id} to {dest_id}")
                            except ValueError:
                                await self.logger.log(f"      -> Invalid destination chat ID: {rule['destination_chat']}")
                            except Exception as e:
                                await self.logger.log(f"      -> Error forwarding: {e}")

            # --- NEW: Auto-Reply Logic ---
            settings = await auto_reply_settings_collection.find_one({"account_phone": phone})

            if settings and settings.get('message'):
                await self.logger.log(f"   -> Auto-reply enabled for {phone}.")
                await self.logger.log(f"[INFO] Auto-reply enabled for {phone}.")
                keywords = [
                    k.strip().lower() 
                    for k in (settings.get('keywords') or "").split(',') 
                    if k.strip()
                ]

                @client.on(events.NewMessage(incoming=True))
                async def auto_reply_handler(event):
                    # Don't reply to yourself
                    if event.is_private and not event.out:
                        message_text = event.raw_text.lower()
                        # If keywords are set, check if any are in the message
                        if keywords:
                            if any(k in message_text for k in keywords):
                                await event.reply(settings['message'])
                                await self.logger.log(f"      -> Auto-replied to {event.sender_id} (keyword matched)")
                                await self.logger.log(f"   -> Auto-replied to {event.sender_id}")
                        # If no keywords, reply to all private messages
                        else:
                            await event.reply(settings['message'])
                            await self.logger.log(f"      -> Auto-replied to {event.sender_id}")
                            await self.logger.log(f"   -> Auto-replied to {event.sender_id}")

            # --- UPDATED: Smart Selling Logic ---
            smart_settings = await smart_selling_settings_collection.find_one({"account_phone": phone})

            if smart_settings and smart_settings.get('enabled') and smart_settings.get('message'):
                await self.logger.log(f"   -> Smart Selling enabled for {phone}.")
                
                must_contain = [
                    k.strip().lower() 
                    for k in (smart_settings.get('must_contain') or "").split(',') 
                    if k.strip()
                ]
                maybe_contain = [
                    k.strip().lower() 
                    for k in (smart_settings.get('maybe_contain') or "").split(',') 
                    if k.strip()
                ]

                @client.on(events.NewMessage(incoming=True))
                async def smart_selling_handler(event):
                    if event.is_private and not event.out:
                        message_text = event.raw_text.lower()
                        
                        # Check conditions
                        must_pass = all(k in message_text for k in must_contain) if must_contain else True
                        maybe_pass = any(k in message_text for k in maybe_contain) if maybe_contain else False
                        
                        # Logic: Must contain all "must" keywords. If "maybe" keywords are also provided, at least one must be present.
                        should_reply = False
                        if must_contain and maybe_contain:
                            if must_pass and maybe_pass:
                                should_reply = True
                        elif must_contain:
                            if must_pass:
                                should_reply = True
                        elif maybe_contain:
                            if maybe_pass:
                                should_reply = True

                        if should_reply:
                            await event.reply(smart_settings['message'])
                            await self.logger.log(f"      -> Smart reply sent to {event.sender_id}")

            await client.run_until_disconnected()

        except Exception as e:
            await accounts_collection.update_one({"phone": phone}, {"$set": {"status": "Error"}})
            await self.logger.log(f"[ERROR] Client {phone} failed to connect: {e}")
        finally:
            if phone in self.clients:
                del self.clients[phone]
            await accounts_collection.update_one({"phone": phone}, {"$set": {"status": "Offline"}})
            await self.logger.log(f"[INFO] Client for {phone} disconnected.")

    # --- NEW: Method to handle joining groups ---
    async def join_groups_for_account(self, phone: str, group_links: list[str]) -> list[dict]:
        """
        Commands a specific client to join a list of groups/channels.
        """
        results = []
        
        if phone not in self.clients:
            return [{"link": link, "status": "error", "reason": "Account is not online"} for link in group_links]

        client: TelegramClient = self.clients[phone]
        
        for link in group_links:
            if not link.strip():
                continue
            
            try:
                await self.logger.log(f"   -> Client {phone} attempting to join {link}...")
                await client(JoinChannelRequest(link))
                results.append({"link": link, "status": "success", "reason": "Successfully joined"})
                await self.logger.log(f"      -> Success.")
            except UserAlreadyParticipantError:
                results.append({"link": link, "status": "skipped", "reason": "Already a member"})
                await self.logger.log(f"      -> Skipped (already a member).")
            except Exception as e:
                error_reason = str(e)
                results.append({"link": link, "status": "error", "reason": error_reason})
                await self.logger.log(f"      -> Error: {error_reason}")
            
            await asyncio.sleep(5) # IMPORTANT: Add a delay to avoid getting banned by Telegram for spamming joins.

        return results


    # --- THIS IS THE MISSING FUNCTION ---
    async def start_interactive_session(self, websocket: WebSocket, owner_user: User):
        """Interactive session for adding new accounts via WebSocket"""
        client = TelegramClient(StringSession(), API_ID, API_HASH)
        correct_phone_number = ""
        try:
            await client.connect()
            await websocket.send_json({"type": "prompt", "message": "Please enter your phone number (e.g., +15551234567):"})
            response = await websocket.receive_json()
            phone_input = response.get("data")
            
            sent_code = await client.send_code_request(phone_input)
            await websocket.send_json({"type": "prompt", "message": "Enter the code you received in Telegram:"})
            response = await websocket.receive_json()
            code = response.get("data")
            
            try:
                await client.sign_in(phone_input, code, phone_code_hash=sent_code.phone_code_hash)
            except SessionPasswordNeededError:
                await websocket.send_json({"type": "prompt", "message": "Two-factor authentication is enabled. Please enter your password:"})
                response = await websocket.receive_json()
                password = response.get("data")
                await client.sign_in(password=password)
            
            me = await client.get_me()
            session_string = client.session.save()
            correct_phone_number = f"+{me.phone}"

            account_doc = {
                "phone": correct_phone_number,
                "session_string": session_string,
                "status": "Online",
                "added_on": datetime.now(),
                "owner": owner_user.username
            }
            
            await accounts_collection.update_one(
                {"phone": correct_phone_number},
                {"$set": account_doc},
                upsert=True
            )
            
            await self.logger.log(f"Login successful for {correct_phone_number}. Session saved.")
            asyncio.create_task(self._run_client(correct_phone_number, session_string))
            
            await websocket.send_json({"type": "success", "message": f"Successfully logged in and saved account {correct_phone_number}!"})
            
        except Exception as e:
            error_message = str(e)
            log_identifier = correct_phone_number or "the user"
            await self.logger.log(f"❌ Login failed for {log_identifier}: {error_message}")
            await websocket.send_json({"type": "error", "message": f"An error occurred: {error_message}"})
        finally:
            if client.is_connected():
                await client.disconnect()

    # --- NEW: Method to validate a Telegram link ---
    async def validate_telegram_link(self, link: str) -> dict:
        """
        Uses an available client to check if a Telegram link is valid.
        """
        # Pick the first available online client to perform the check
        if not self.clients:
            return {"status": "error", "result": "No accounts are online to perform the check."}
        
        # Get the client instance from the dictionary
        phone, client = next(iter(self.clients.items()))
        await self.logger.log(f"   -> Using client {phone} to validate link: {link}")

        try:
            entity = await client.get_entity(link)
            
            entity_type = "Unknown"
            if isinstance(entity, Channel):
                entity_type = "Public Channel" if entity.broadcast else "Public Group"
            elif isinstance(entity, User):
                entity_type = "User" if not entity.bot else "Bot"
                
            return {"status": "success", "result": f"Active ({entity_type})"}
        
        except (ValueError, TypeError):
            return {"status": "error", "result": "Not Found (Invalid or Expired Link)"}
        except Exception as e:
            return {"status": "error", "result": f"An unexpected error occurred: {e}"}
        
    # --- NEW: Method to extract data from a channel ---
    async def extract_from_channel(self, phone: str, channel_link: str, extract_type: str, limit: int) -> dict:
        """
        Uses a specific client to scrape messages from a channel/group.
        """
        if phone not in self.clients:
            return {"status": "error", "data": "Account is not online."}

        client: TelegramClient = self.clients[phone]
        results = set() # Use a set to store unique results

        # Define regular expressions for extraction
        patterns = {
            "usernames": r"@([a-zA-Z0-9_]{5,32})",
            "links": r"t\.me/([a-zA-Z0-9_+/]+)",
            "phones": r"\+?[0-9\s\-\(\)]{8,}" # A simple regex for phone numbers
        }
        
        if extract_type not in patterns:
            return {"status": "error", "data": "Invalid extraction type."}
        
        regex = re.compile(patterns[extract_type])

        try:
            await self.logger.log(f"   -> Client {phone} starting extraction from {channel_link}...")
            # Use client.iter_messages to efficiently get messages
            async for message in client.iter_messages(channel_link, limit=limit):
                if message.text:
                    matches = regex.findall(message.text)
                    for match in matches:
                        # Add prefix for usernames if not present
                        if extract_type == "usernames" and not match.startswith('@'):
                            results.add(f"@{match}")
                        # Add prefix for links if not present
                        elif extract_type == "links" and not match.startswith('t.me/'):
                            results.add(f"t.me/{match}")
                        else:
                            results.add(match)
            
            await self.logger.log(f"   -> Extraction complete. Found {len(results)} unique items.")
            return {"status": "success", "data": sorted(list(results))}

        except Exception as e:
            error_message = f"An error occurred: {e}"
            await self.logger.log(f"   -> Extraction failed: {error_message}")
            return {"status": "error", "data": error_message}
        
    # --- NEW: Method to handle a single message forwarding job ---
    async def start_forwarding_job(self, phone: str, message_link: str, delay: int, cycle_delay: int, targets: list[str], hide_sender: bool) -> dict:
        """
        Starts a background task to forward a single message to multiple targets.
        """
        if phone not in self.clients:
            return {"status": "error", "message": "Account is not online."}

        client: TelegramClient = self.clients[phone]
        
        # We run this in the background so the API request can return immediately
        asyncio.create_task(self._forwarding_job_runner(client, message_link, delay, cycle_delay, targets, hide_sender))
        
        return {"status": "success", "message": "Forwarding job started successfully in the background."}

    async def _forwarding_job_runner(self, client: TelegramClient, message_link: str, delay: int, cycle_delay: int, targets: list[str], hide_sender: bool):
        """The actual background task that performs the forwarding."""
        try:
            # Parse the message link to get chat and message ID
            # Example: https://t.me/somechannel/1234
            parts = message_link.rstrip('/').split('/')
            chat = parts[-2]
            message_id = int(parts[-1])
            
            await self.logger.log(f"   -> Starting forwarding job for message {message_id} from {chat}")
            
            # Initial delay before starting the cycle
            await asyncio.sleep(delay)
            
            for target in targets:
                try:
                    await self.logger.log(f"      -> Forwarding to {target}...")
                    if hide_sender:
                        # Fetch the message and send a copy to hide the origin
                        message_to_send = await client.get_messages(chat, ids=message_id)
                        if message_to_send:
                            await client.send_message(target, message_to_send)
                    else:
                        # Normal forward which shows "Forwarded from"
                        await client.forward_messages(target, message_id, from_peer=chat)
                    
                    await self.logger.log(f"      -> Success. Waiting for cycle delay of {cycle_delay}s.")
                    await asyncio.sleep(cycle_delay)
                
                except Exception as e:
                    await self.logger.log(f"      -> Failed to forward to {target}: {e}")
            
            await self.logger.log(f"   -> Forwarding job for {message_id} completed.")

        except Exception as e:
            await self.logger.log(f"❌ Error in forwarding job runner: {e}")

    # --- NEW: Method to reload rules for a specific client ---
    async def reload_rules_for_client(self, phone: str):
        """
        Reloads forwarding rules for a specific client.
        This could be called when rules are updated in the database.
        """
        if phone not in self.clients:
            await self.logger.log(f"[WARNING] Cannot reload rules for {phone} - client not connected")
            return False

        try:
            # This is a simplified approach - in a production system,
            # you might want to more gracefully handle rule reloading
            client = self.clients[phone]
            
            # Remove old handlers (this is complex with Telethon)
            # For now, we'll just log that rules should be reloaded on next restart
            await self.logger.log(f"[INFO] Rules updated for {phone}. Changes will take effect on next client restart.")
            return True
            
        except Exception as e:
            await self.logger.log(f"[ERROR] Failed to reload rules for {phone}: {e}")
            return False

    # --- NEW: Method to get client status ---
    def get_client_status(self, phone: str) -> dict:
        """
        Returns the status of a specific client.
        """
        if phone in self.clients:
            client = self.clients[phone]
            return {
                "phone": phone,
                "status": "connected" if client.is_connected() else "disconnected",
                "is_user_authorized": client.is_user_authorized()
            }
        else:
            return {
                "phone": phone,
                "status": "not_running",
                "is_user_authorized": False
            }

    # --- NEW: Method to disconnect a specific client ---
    async def disconnect_client(self, phone: str) -> bool:
        """
        Safely disconnects a specific client.
        """
        if phone not in self.clients:
            return False

        try:
            client = self.clients[phone]
            await client.disconnect()
            del self.clients[phone]
            await self._update_account_status(phone, "Offline")
            await self.logger.log(f"[INFO] Client {phone} manually disconnected.")
            return True
        except Exception as e:
            await self.logger.log(f"[ERROR] Failed to disconnect client {phone}: {e}")
            return False

    # --- NEW: Method to get all client statuses ---
    def get_all_client_statuses(self) -> dict:
        """
        Returns the status of all clients.
        """
        statuses = {}
        for phone in self.clients:
            statuses[phone] = self.get_client_status(phone)
        return statuses