import urllib.request
import json

# 一个 20x20 的红色 PNG 图片
valid_image_base64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAKUlEQVQ4y+3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAB4GKKYAAW9Fw0IAAAAASUVORK5CYII="

url = "http://localhost:8000/api/chat"
headers = {"Content-Type": "application/json"}
data = {
    "messages": [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "描述这个图片"},
                {"type": "image_url", "image_url": {"url": valid_image_base64}}
            ]
        }
    ],
    "stream": False
}

req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers=headers)

try:
    with urllib.request.urlopen(req) as response:
        print(f"Status Code: {response.getcode()}")
        print(f"Response: {response.read().decode('utf-8')}")
except urllib.error.HTTPError as e:
    print(f"HTTP Error: {e.code}")
    print(f"Response: {e.read().decode('utf-8')}")
except Exception as e:
    print(f"Error: {e}")
