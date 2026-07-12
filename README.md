# RegBridge

A small prototype for handling SEBI circular compliance work in a more practical way. You can upload a circular PDF, pull out obligations with AI, track what is done, compare updated versions of the same circular, and keep a simple audit trail.

This version uses a plain HTML, CSS, and JavaScript front end with a FastAPI backend backed by Mistral and Supabase. It is meant to be easy to run locally and easy to inspect.

---

## What it does

- Upload a real SEBI circular PDF
- Extract obligations from the text with AI
- Track status for each obligation
- Compare a newer circular with an older one
- Keep a record of changes and updates

There is no sample data or placeholder content bundled with the app. The dashboard starts empty until you add something real.

---

## How it is built

| Layer | Tooling |
|---|---|
| Frontend | Plain HTML, CSS, and JavaScript |
| PDF extraction | pdf.js in the browser |
| AI extraction | FastAPI backend calling Mistral |
| Storage | Supabase Postgres |
| Secrets | Stored in backend/.env only |

The browser talks only to the local backend at http://localhost:8000.

---

## Setup

### 1. Create the database

1. Create a Supabase project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run the contents of backend/schema.sql once.
3. In Project Settings → API, copy:
   - Project URL → SUPABASE_URL
   - service_role key → SUPABASE_SERVICE_KEY

### 2. Create a Mistral key

1. Sign up at [console.mistral.ai](https://console.mistral.ai).
2. Create an API key and set it as MISTRAL_API_KEY.
3. The default model is mistral-small-latest, which is fine for this prototype.

### 3. Set up the backend environment

```bash
cd backend
copy .env.example .env    # Windows
# cp .env.example .env    # macOS/Linux
```

Fill in the values in backend/.env:

```env
MISTRAL_API_KEY=...
MISTRAL_MODEL=mistral-small-latest
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=...
```

### 4. Install Python dependencies

```bash
cd backend
python -m venv venv
venv\Scripts\activate     # Windows
# source venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
```

### 5. Run the backend

```bash
cd backend
uvicorn main:app --reload
```

The API should be available at http://localhost:8000.

### 6. Serve the frontend

Open a second terminal at the project root and run:

```bash
python -m http.server 5500
```

Then open http://localhost:5500.

---

## Using the app

1. Upload a circular PDF and choose the intermediary type.
2. Extract the text in the browser and send it to the backend for obligation extraction.
3. Review the extracted obligations before saving them.
4. Use the dashboard to track status and add notes.
5. Compare an amended circular with an older version to spot changes.

There is no settings page. Configuration lives in backend/.env.

---

## A few practical notes

- If the AI call fails, the app shows the real error instead of inventing results.
- If Supabase write or read fails, the app shows the error instead of silently failing.
- Evidence is tracked by filename only; the file contents are not uploaded and stored separately.
- The diff view only compares obligations that were extracted on both sides.

---

## Project structure

```text
regbridge/
├── index.html
├── css/style.css
├── js/
│   ├── vendor/pdf.min.js, pdf.worker.min.js
│   ├── storage.js
│   ├── pdfExtract.js
│   ├── aiExtract.js
│   ├── diff.js
│   ├── dashboard.js
│   ├── audit.js
│   └── app.js
├── backend/
│   ├── main.py
│   ├── schema.sql
│   ├── requirements.txt
│   ├── .env.example
│   └── .env
├── .gitignore
└── README.md
```

---

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | /api/health | Check backend status |
| POST | /api/extract-obligations | Extract obligations from text |
| POST | /api/circulars | Save a circular and its obligations |
| GET | /api/circulars | List circulars |
| GET | /api/circulars/{id} | Get one circular with obligations |
| PATCH | /api/obligations/{id} | Update status or evidence |
| GET | /api/audit | Get the audit log |
| POST | /api/audit | Add an audit event |
| GET | /api/stats | Get dashboard stats |

---

## Browser support

Any recent browser should work, including Chrome, Edge, Firefox, and Safari. The app needs internet for the backend calls and for fonts on first load. PDF parsing works locally through the bundled pdf.js files.
