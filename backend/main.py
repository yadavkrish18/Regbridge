"""
RegBridge FastAPI backend — Mistral AI extraction + Supabase persistence.
"""

import json
import os
from datetime import datetime, timezone
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from mistralai.client import Mistral
from pydantic import BaseModel, Field
from supabase import Client, create_client

load_dotenv()

MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY", "")
MISTRAL_MODEL = os.getenv("MISTRAL_MODEL", "mistral-small-latest")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS", "http://localhost:5500,http://127.0.0.1:5500"
    ).split(",")
    if o.strip()
]

MAX_CIRCULAR_CHARS = 120000

OBLIGATION_SYSTEM_PROMPT = """You are a regulatory compliance analyst reading an Indian SEBI (Securities and Exchange Board of India) circular.

Read the circular text provided and extract every distinct compliance obligation it imposes on the intermediary type given.

Return ONLY a JSON object (no prose, no markdown fences) with exactly this shape:
{ "obligations": [ ...array of obligation objects... ] }

Each obligation object must have exactly these fields:
- "description": a single, self-contained obligation, written plainly (1-2 sentences)
- "category": one short category label, e.g. "Disclosure", "KYC", "Reporting", "Governance", "Risk Management", "Grievance Redressal", "Recordkeeping", "Fees", "Timeline/Deadline", "Other"
- "deadline": the compliance deadline or frequency exactly as stated in the text (e.g. "Within 30 days of circular date", "Annually", "Ongoing"), or "Not specified" if the text does not state one
- "intermediary_type": the intermediary type this obligation applies to (use the type given to you unless the text specifies a different/narrower one)
- "source_excerpt": a short excerpt (under 25 words) from the original text that supports this obligation

Only extract obligations that are actually present in the text. Do not invent, generalize, or add obligations not stated in the circular. If the circular contains no extractable obligations, return { "obligations": [] }."""


def get_supabase() -> Client:
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise HTTPException(
            status_code=503,
            detail="Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in backend/.env",
        )
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def get_mistral() -> Mistral:
    if not MISTRAL_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Mistral API key is not configured. Set MISTRAL_API_KEY in backend/.env",
        )
    return Mistral(api_key=MISTRAL_API_KEY)


def truncate_text(text: str, max_chars: int = MAX_CIRCULAR_CHARS) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n\n[...truncated for length...]"


def build_obligation_prompt(circular_text: str, intermediary_type: str) -> str:
    return f"""Intermediary type: {intermediary_type}

Circular text:
\"\"\"
{circular_text}
\"\"\"

Extract the obligations now, following the system instructions exactly."""


def obligation_row_to_api(row: dict) -> dict:
    return {
        "id": row["id"],
        "description": row["description"],
        "category": row["category"],
        "deadline": row["deadline"],
        "intermediaryType": row["intermediary_type"],
        "sourceExcerpt": row.get("source_excerpt") or "",
        "status": row.get("status") or "Missing",
        "evidenceNote": row.get("evidence_note") or "",
        "evidenceFileName": row.get("evidence_file_name") or "",
        "updatedAt": row.get("updated_at") or "",
    }


def circular_row_to_api(circular: dict, obligations: list[dict]) -> dict:
    return {
        "id": circular["id"],
        "title": circular["title"],
        "ref": circular.get("ref") or "",
        "intermediary": circular["intermediary"],
        "createdAt": circular.get("created_at") or "",
        "rawText": circular.get("raw_text") or "",
        "obligations": [obligation_row_to_api(o) for o in obligations],
    }


async def call_mistral_json(system_prompt: str, user_prompt: str) -> str:
    client = get_mistral()
    try:
        response = client.chat.complete(
            model=MISTRAL_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    content = response.choices[0].message.content
    if not content:
        raise HTTPException(
            status_code=502,
            detail="Mistral returned an empty response. Try a shorter excerpt or check your API key quota.",
        )
    return content


class ExtractObligationsRequest(BaseModel):
    circularText: str
    intermediaryType: str


class ObligationInput(BaseModel):
    id: str
    description: str
    category: str = "Other"
    deadline: str = "Not specified"
    intermediaryType: str
    sourceExcerpt: str = ""
    status: str = "Missing"
    evidenceNote: str = ""
    evidenceFileName: str = ""
    updatedAt: Optional[str] = None


class SaveCircularRequest(BaseModel):
    id: str
    title: str
    ref: str = ""
    intermediary: str
    createdAt: Optional[str] = None
    rawText: str
    obligations: list[ObligationInput]


class PatchObligationRequest(BaseModel):
    status: Optional[str] = None
    evidenceNote: Optional[str] = None
    evidenceFileName: Optional[str] = None
    auditEvent: Optional[str] = None
    auditRef: Optional[str] = None
    auditDetail: Optional[str] = None


class LogEventRequest(BaseModel):
    event: str
    ref: str = ""
    detail: str = ""


app = FastAPI(title="RegBridge API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health(verify: bool = Query(default=False)):
    result: dict[str, Any] = {
        "ok": True,
        "mistralConfigured": bool(MISTRAL_API_KEY),
        "supabaseConfigured": bool(SUPABASE_URL and SUPABASE_SERVICE_KEY),
        "mistralModel": MISTRAL_MODEL,
    }

    if verify:
        if not MISTRAL_API_KEY:
            raise HTTPException(
                status_code=503,
                detail="Mistral API key is not configured. Set MISTRAL_API_KEY in backend/.env",
            )
        try:
            raw = await call_mistral_json(
                "You reply only with strict JSON.",
                'Reply with the JSON object {"ok": true}.',
            )
            parsed = json.loads(raw)
            if not parsed or parsed.get("ok") is not True:
                raise HTTPException(
                    status_code=502,
                    detail=f"Mistral returned an unexpected response: {raw[:200]}",
                )
            result["mistralVerified"] = True
        except HTTPException:
            raise
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=502, detail=f"Mistral response was not valid JSON: {exc}"
            ) from exc

    return result


@app.post("/api/extract-obligations")
async def extract_obligations(body: ExtractObligationsRequest):
    if not body.circularText.strip():
        raise HTTPException(status_code=400, detail="circularText is required")

    trimmed = truncate_text(body.circularText)
    raw = await call_mistral_json(
        OBLIGATION_SYSTEM_PROMPT,
        build_obligation_prompt(trimmed, body.intermediaryType),
    )

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Model response was not valid JSON. Raw response: {raw[:300]}",
        ) from exc

    obligations = parsed.get("obligations") if isinstance(parsed, dict) else None
    if obligations is None:
        raise HTTPException(
            status_code=502,
            detail="Model response was valid JSON but missing an 'obligations' array.",
        )
    if not isinstance(obligations, list):
        raise HTTPException(
            status_code=502,
            detail="Model response 'obligations' field was not an array.",
        )

    return obligations


@app.post("/api/circulars")
async def save_circular(body: SaveCircularRequest):
    sb = get_supabase()
    created_at = body.createdAt or datetime.now(timezone.utc).isoformat()

    circular_row = {
        "id": body.id,
        "title": body.title,
        "ref": body.ref,
        "intermediary": body.intermediary,
        "created_at": created_at,
        "raw_text": body.rawText,
    }

    obligation_rows = []
    for obl in body.obligations:
        obligation_rows.append(
            {
                "id": obl.id,
                "circular_id": body.id,
                "description": obl.description,
                "category": obl.category,
                "deadline": obl.deadline,
                "intermediary_type": obl.intermediaryType,
                "source_excerpt": obl.sourceExcerpt,
                "status": obl.status,
                "evidence_note": obl.evidenceNote,
                "evidence_file_name": obl.evidenceFileName,
                "updated_at": obl.updatedAt or datetime.now(timezone.utc).isoformat(),
            }
        )

    try:
        sb.table("circulars").upsert(circular_row).execute()
        if obligation_rows:
            sb.table("obligations").upsert(obligation_rows).execute()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return circular_row_to_api(circular_row, obligation_rows)


@app.get("/api/circulars")
async def list_circulars():
    sb = get_supabase()
    try:
        circulars_res = (
            sb.table("circulars").select("*").order("created_at", desc=True).execute()
        )
        obligations_res = sb.table("obligations").select("*").execute()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    obligations_by_circular: dict[str, list] = {}
    for row in obligations_res.data or []:
        obligations_by_circular.setdefault(row["circular_id"], []).append(row)

    return [
        circular_row_to_api(c, obligations_by_circular.get(c["id"], []))
        for c in circulars_res.data or []
    ]


@app.get("/api/circulars/{circular_id}")
async def get_circular(circular_id: str):
    sb = get_supabase()
    try:
        circular_res = (
            sb.table("circulars").select("*").eq("id", circular_id).maybe_single().execute()
        )
        if not circular_res.data:
            raise HTTPException(status_code=404, detail="Circular not found")
        obligations_res = (
            sb.table("obligations").select("*").eq("circular_id", circular_id).execute()
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return circular_row_to_api(circular_res.data, obligations_res.data or [])


@app.patch("/api/obligations/{obligation_id}")
async def patch_obligation(obligation_id: str, body: PatchObligationRequest):
    sb = get_supabase()
    try:
        existing_res = (
            sb.table("obligations")
            .select("*")
            .eq("id", obligation_id)
            .maybe_single()
            .execute()
        )
        if not existing_res.data:
            raise HTTPException(status_code=404, detail="Obligation not found")

        patch: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
        if body.status is not None:
            patch["status"] = body.status
        if body.evidenceNote is not None:
            patch["evidence_note"] = body.evidenceNote
        if body.evidenceFileName is not None:
            patch["evidence_file_name"] = body.evidenceFileName

        updated_res = (
            sb.table("obligations")
            .update(patch)
            .eq("id", obligation_id)
            .execute()
        )
        updated = (updated_res.data or [None])[0]
        if not updated:
            raise HTTPException(status_code=502, detail="Failed to update obligation")

        if body.auditEvent:
            sb.table("audit_log").insert(
                {
                    "event": body.auditEvent,
                    "ref": body.auditRef or obligation_id,
                    "detail": body.auditDetail or "",
                }
            ).execute()

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return obligation_row_to_api(updated)


@app.get("/api/audit")
async def get_audit():
    sb = get_supabase()
    try:
        res = (
            sb.table("audit_log")
            .select("ts, event, ref, detail")
            .order("ts", desc=True)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return [
        {
            "ts": row["ts"],
            "event": row["event"],
            "ref": row["ref"],
            "detail": row["detail"],
        }
        for row in res.data or []
    ]


@app.post("/api/audit")
async def log_event(body: LogEventRequest):
    sb = get_supabase()
    try:
        res = (
            sb.table("audit_log")
            .insert({"event": body.event, "ref": body.ref, "detail": body.detail})
            .execute()
        )
        row = (res.data or [{}])[0]
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "ts": row.get("ts", datetime.now(timezone.utc).isoformat()),
        "event": body.event,
        "ref": body.ref,
        "detail": body.detail,
    }


@app.get("/api/stats")
async def get_stats():
    sb = get_supabase()
    try:
        circulars_res = sb.table("circulars").select("id", count="exact").execute()
        obligations_res = sb.table("obligations").select("status").execute()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    obligations = obligations_res.data or []
    by_status = {"Done": 0, "Gap": 0, "Missing": 0}
    for row in obligations:
        status = row.get("status") or "Missing"
        by_status[status] = by_status.get(status, 0) + 1

    return {
        "circulars": circulars_res.count or 0,
        "obligations": len(obligations),
        "byStatus": by_status,
        "audit": 0,
    }
