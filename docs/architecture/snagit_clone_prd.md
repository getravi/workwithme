# Snagit Clone (Tauri + Rust) — PRD

## 1. Overview

A lightweight desktop app for screen capture, annotation, and sharing.

Core workflow:
Capture → Edit → Share

---

## 2. Target Users

- Knowledge workers
- Engineers / PMs
- Customer support teams

---

## 3. Core Features (v1)

### Capture
- Region capture
- Fullscreen capture
- Window capture
- Global hotkeys

### Editor
- Crop / resize
- Arrows
- Text
- Shapes
- Blur / redact
- Highlight
- Numbered steps

### Recording
- Screen recording
- Microphone input
- Export to MP4
- Trim

### Library
- Local auto-save
- Thumbnail grid
- Search
- Tags

### Sharing
- Copy to clipboard
- Export PNG/JPG/MP4

### OCR
- Extract text from image
- Copy to clipboard

---

## 4. UX Requirements

- Instant capture feedback
- Keyboard-first workflows
- Fast performance (<150ms capture)

---

## 5. Technical Architecture

### Stack

Desktop:
- Tauri v2
- Rust backend

Frontend:
- React + TypeScript + Vite
- Zustand

Canvas:
- Konva.js

Backend (Rust):
- Screen capture
- File system
- Clipboard
- Hotkeys
- OCR
- Export

Image Processing:
- image
- imageproc

Persistence:
- SQLite

Video:
- FFmpeg

OCR:
- Tesseract

---

## 6. Core Modules

### Capture Module
Handles screen capture via OS APIs

### Editor Module
Canvas + annotation system

### Storage Module
Filesystem + SQLite metadata

### OCR Module
Text extraction

### Export Module
Image/video export

### System Module
Hotkeys, clipboard, tray

---

## 7. Data Model

Capture:
- id
- type
- file_path
- created_at
- tags
- annotations

Annotation:
- type
- position
- style

---

## 8. MVP Scope

Phase 1:
- Region capture
- Basic editor
- Clipboard export

Phase 2:
- Library
- Fullscreen/window capture

Phase 3:
- Recording
- OCR

---

## 9. Differentiation Ideas

- AI-generated guides
- Auto bug reports
- Notion/Slack export

---

## 10. Risks

- OS-specific capture complexity
- Video performance
- Canvas scaling

---

## 11. Success Metrics

- Capture <3s
- High edit rate
- Repeat usage
