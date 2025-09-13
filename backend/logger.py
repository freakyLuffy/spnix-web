# backend/logger.py

import asyncio
from typing import List
from fastapi import WebSocket

class LogBroadcaster:
    """
    Manages active WebSocket connections and broadcasts log messages to all clients.
    """
    def __init__(self):
        self.connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        """Accepts and stores a new WebSocket connection."""
        await websocket.accept()
        self.connections.append(websocket)
        print("Log client connected.")

    def disconnect(self, websocket: WebSocket):
        """Removes a WebSocket connection."""
        self.connections.remove(websocket)
        print("Log client disconnected.")

    async def log(self, message: str):
        """Broadcasts a log message to all connected clients."""
        # We create a list of tasks to send messages concurrently
        tasks = [
            connection.send_text(message)
            for connection in self.connections
        ]
        # Run all send tasks
        await asyncio.gather(*tasks, return_exceptions=True)

# Create a single, global instance of the broadcaster
log_broadcaster = LogBroadcaster()