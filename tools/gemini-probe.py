#!/usr/bin/env python3
"""Check which Gemini models the key can reach, and confirm the extraction
settings work. Reads GEMINI_API_KEY from ~/.config/health/env. Never prints it."""
import json
import os
import sys
import urllib.error
import urllib.request

ENV = os.path.expanduser("~/.config/health/env")
KEY = None
for line in open(ENV):
    if line.startswith("GEMINI_API_KEY="):
        KEY = line.split("=", 1)[1].strip()
if not KEY:
    sys.exit("GEMINI_API_KEY not found in " + ENV)

BASE = "https://generativelanguage.googleapis.com/v1beta"


def call(path, body=None):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode() if body else None,
        headers={"x-goog-api-key": KEY, "Content-Type": "application/json"},
        method="POST" if body else "GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


if sys.argv[1:2] == ["list"]:
    code, d = call("/models?pageSize=200")
    names = [m["name"].split("/")[-1] for m in d.get("models", [])
             if "generateContent" in m.get("supportedGenerationMethods", [])]
    print("HTTP", code)
    for n in sorted(names):
        if "flash" in n or "pro" in n:
            print(" ", n)
    sys.exit(0)

model = sys.argv[1] if sys.argv[1:] else "gemini-3.8-flash"
code, d = call(f"/models/{model}:generateContent", {
    "contents": [{"parts": [{"text": "Reply with exactly: OK"}]}],
    "generationConfig": {"responseMimeType": "application/json",
                         "responseSchema": {"type": "OBJECT",
                                            "properties": {"reply": {"type": "STRING"}},
                                            "required": ["reply"]},
                         "thinkingConfig": {"thinkingLevel": "LOW"}},
})
print(model, "->", "HTTP", code)
print(json.dumps(d)[:500])
