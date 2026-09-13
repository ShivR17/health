#!/usr/bin/env python3
"""End-to-end test of the extract Edge Function.

Creates a throwaway user, signs in as them to get a real JWT, posts a file,
prints what came back, then deletes the throwaway user. Never touches the
real account and never prints a credential.

Usage: tools/test-extract.py <scan|blood> <file>
"""
import base64
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.request

ENV = os.path.expanduser("~/.config/health/env")
cfg = {}
for line in open(ENV):
    if "=" in line:
        k, v = line.strip().split("=", 1)
        cfg[k] = v
URL = cfg["SUPABASE_URL"]
SECRET = cfg["SUPABASE_SECRET"]

TEST_EMAIL = "extract-test@example.com"
TEST_PW = "throwaway-password-9f2b7c"


def req(path, body=None, token=None, method=None, admin=False):
    h = {"Content-Type": "application/json",
         "apikey": SECRET if admin else SECRET,
         "Authorization": "Bearer " + (token or SECRET)}
    r = urllib.request.Request(
        URL + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers=h, method=method or ("POST" if body is not None else "GET"))
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw or "{}")
        except json.JSONDecodeError:
            return e.code, {"raw": raw[:300]}


def main():
    kind, path = sys.argv[1], sys.argv[2]
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    data = base64.b64encode(open(path, "rb").read()).decode()

    # throwaway user
    code, user = req("/auth/v1/admin/users",
                     {"email": TEST_EMAIL, "password": TEST_PW,
                      "email_confirm": True}, admin=True)
    uid = user.get("id")
    if not uid:  # already exists from an earlier run
        code, lst = req("/auth/v1/admin/users?per_page=200", admin=True)
        uid = next((u["id"] for u in lst.get("users", [])
                    if u["email"] == TEST_EMAIL), None)

    try:
        code, sess = req("/auth/v1/token?grant_type=password",
                         {"email": TEST_EMAIL, "password": TEST_PW})
        token = sess.get("access_token")
        if not token:
            print("sign-in failed:", code, sess)
            return 1

        code, out = req("/functions/v1/extract",
                        {"kind": kind, "mime": mime, "data": data}, token=token)
        print("HTTP", code)
        print(json.dumps(out, indent=2)[:2000])
    finally:
        if uid:
            req(f"/auth/v1/admin/users/{uid}", method="DELETE", admin=True)
            print("\n(throwaway user removed)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
