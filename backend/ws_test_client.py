#!/usr/bin/env python3
"""
Simple WebSocket test client to drive the `/ws/upload` endpoint without the frontend.

- Sends all images from a directory (ordered by name) as binary frames.
- Listens for text messages like "filename:<id>", "status:done:<id>", and binary blobs (PLY).
- Saves any incoming binary to /tmp/received_<id>.ply (or a timestamped name if no id queued).

Usage:
  python3 ws_test_client.py /path/to/images --delay 0.01

Requires: pip install websockets
"""

import argparse
import asyncio
import os
import sys
import time
from pathlib import Path

import websockets


async def recv_loop(ws, pending_ids):
    """Receive loop: handles text and binary messages from server."""
    try:
        async for msg in ws:
            if isinstance(msg, bytes):
                id_tag = None
                if pending_ids:
                    id_tag = pending_ids.pop(0)
                filename = id_tag or str(int(time.time() * 1000))
                out_path = Path('/tmp') / f"received_{filename}.ply"
                with open(out_path, 'wb') as f:
                    f.write(msg)
                print(f"[recv] Saved binary to {out_path} (id={id_tag})")
            else:
                # Text message
                text = msg
                if text.startswith('filename:'):
                    fid = text.split(':', 1)[1]
                    pending_ids.append(fid)
                    print(f"[recv] filename announcement: {fid}")
                elif text.startswith('status:'):
                    print(f"[recv] status: {text}")
                else:
                    print(f"[recv] text: {text}")
    except websockets.ConnectionClosed as e:
        print(f"[recv] connection closed: code={e.code} reason={e.reason}")
    except Exception as e:
        print('[recv] error in recv loop:', repr(e))


async def send_images(ws, images, delay):
    """Send images sequentially as binary frames."""
    for p in images:
        data = p.read_bytes()
        try:
            await ws.send(data)
            print(f"[send] Sent {p.name} ({len(data)} bytes)")
        except Exception as e:
            print(f"[send] failed to send {p}: {e}")
            return
        await asyncio.sleep(delay)


async def main(uri, images_dir, delay):
    images_dir = Path(images_dir)
    images = sorted([p for p in images_dir.iterdir() if p.is_file() and p.suffix.lower() in ('.png', '.jpg', '.jpeg')])
    if not images:
        print('No images found in', images_dir)
        return

    pending_ids = []
    print(f"Connecting to {uri}...")
    try:
        async with websockets.connect(uri, max_size=None, ping_interval=None) as ws:
            print('Connected')
            recv_task = asyncio.create_task(recv_loop(ws, pending_ids))

            # Send images
            await send_images(ws, images, delay)

            # Inform server that we are done sending images so it can flush any remaining partial batch
            try:
                await ws.send("done")
                print('[send] Sent done')
            except Exception as e:
                print(f"[send] failed to send done: {e}")

            print('[main] done sending images -- keeping connection open to receive results')

            await asyncio.sleep(300)

            # Close gracefully
            await ws.close()
            await recv_task
    except Exception as e:
        print('Connection error:', repr(e))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('images_dir', help='Directory containing images to send')
    parser.add_argument('--uri', default='ws://localhost:8000/ws/upload', help='WebSocket URI')
    parser.add_argument('--delay', type=float, default=0.01, help='Seconds between sends')
    args = parser.parse_args()
    asyncio.run(main(args.uri, args.images_dir, args.delay))
