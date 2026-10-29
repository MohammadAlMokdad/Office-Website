"""Send a Python file to the Blender MCP addon socket (localhost:9876) and print what it printed.

    python bl.py <script.py> [timeout_seconds] [--lib]

--lib prepends web_lib.py (shared helpers) to the script.
"""
import json
import os
import socket
import sys


def send(code, timeout):
    s = socket.create_connection(("127.0.0.1", 9876), timeout=timeout)
    s.settimeout(timeout)
    s.sendall(json.dumps({"type": "execute_code", "params": {"code": code}}).encode("utf-8"))
    buf = b""
    while True:
        chunk = s.recv(1 << 20)
        if not chunk:
            break
        buf += chunk
        try:
            resp = json.loads(buf.decode("utf-8"))
            break
        except json.JSONDecodeError:
            continue
    s.close()
    return resp


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    with open(args[0], encoding="utf-8") as f:
        code = f.read()
    if "--lib" in sys.argv:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "web_lib.py"), encoding="utf-8") as f:
            code = f.read() + "\n" + code
    resp = send(code, float(args[1]) if len(args) > 1 else 900)
    if resp.get("status") != "success":
        print("ERROR:", resp.get("message", resp))
        sys.exit(1)
    res = resp.get("result")
    print(res.get("result", res) if isinstance(res, dict) else res)
