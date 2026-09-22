import os
import time
import uuid
import jwt as pyjwt
from flask import Blueprint, jsonify, g, request
from auth import require_auth_or_dealer

chat_bp = Blueprint("chat_api", __name__)
SUPABASE_JWT_SECRET=os.environ.get("SUPABASE_JWT_SECRET","")
LIVEKIT_API_KEY=os.environ.get("LIVEKIT_API_KEY","")
LIVEKIT_API_SECRET=os.environ.get("LIVEKIT_API_SECRET","")

def _chat_identity():
    payload=g.current_user_payload
    if payload.get("scope")=="dealer":
        return f"dealer-{payload['uid']}", payload.get("username") or "Dealer"
    return f"staff-{payload['uid']}", payload.get("username") or "Staff"

@chat_bp.route("/token",methods=["GET"])
@require_auth_or_dealer
def chat_token():
    if not SUPABASE_JWT_SECRET:
        return jsonify({"error":"SUPABASE_JWT_SECRET not configured on the server"}),500
    uid,name=_chat_identity(); now=int(time.time())
    token=pyjwt.encode({"sub":uid,"role":"authenticated","name":name,"iat":now,"exp":now+3600},SUPABASE_JWT_SECRET,algorithm="HS256")
    return jsonify({"token":token})

@chat_bp.route("/call-token",methods=["GET"])
@require_auth_or_dealer
def call_token():
    if not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
        return jsonify({"error":"LIVEKIT_API_KEY / LIVEKIT_API_SECRET not configured on the server"}),500
    room=request.args.get("room")
    if not room:return jsonify({"error":"room is required"}),400
    uid,name=_chat_identity(); now=int(time.time())
    token=pyjwt.encode({"iss":LIVEKIT_API_KEY,"sub":uid,"name":name,"jti":str(uuid.uuid4()),"iat":now,"nbf":now,"exp":now+3600,"video":{"room":room,"roomJoin":True,"canPublish":True,"canSubscribe":True,"canPublishData":True}},LIVEKIT_API_SECRET,algorithm="HS256")
    return jsonify({"token":token})
