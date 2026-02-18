#!/usr/bin/env bash
# MayaMind POC — one-time setup script
# Run from the project root: chmod +x setup.sh && ./setup.sh

set -e

echo "=== MayaMind POC Setup ==="
echo ""

# ── Directories ────────────────────────────────────────────────────────────────
mkdir -p public/modules public/avatars public/animations

# ── TalkingHead repo ───────────────────────────────────────────────────────────
TH_DIR="/tmp/talkinghead-repo"

if [ -d "$TH_DIR/.git" ]; then
  echo "Updating cached TalkingHead repo..."
  git -C "$TH_DIR" pull --ff-only --quiet
else
  echo "Cloning TalkingHead repository (shallow)..."
  git clone --depth 1 https://github.com/met4citizen/TalkingHead "$TH_DIR"
fi
echo ""

# ── JS modules ────────────────────────────────────────────────────────────────
echo "Copying TalkingHead modules..."
cp -r "$TH_DIR/modules/." public/modules/
echo "  ✓ public/modules/"

# ── Avatar GLB files ──────────────────────────────────────────────────────────
echo "Looking for sample avatars..."
if ls "$TH_DIR"/avatars/*.glb >/dev/null 2>&1; then
  cp "$TH_DIR"/avatars/*.glb public/avatars/
  echo "  ✓ public/avatars/ ($(ls public/avatars/*.glb | wc -l | tr -d ' ') GLB files)"
else
  echo "  ⚠ No GLB avatars found in TalkingHead repo."
  echo "    Options:"
  echo "      a) Check TalkingHead GitHub Releases for a demo package with avatars"
  echo "      b) Use any Mixamo-rigged GLB with ARKit blend shapes"
  echo "      c) See TalkingHead README → /blender for creating a compatible avatar"
  echo "    → Place the GLB file in public/avatars/ and update AVATAR_URL in public/app.js"
fi

# ── FBX animations ────────────────────────────────────────────────────────────
echo "Looking for sample animations..."
if ls "$TH_DIR"/animations/*.fbx >/dev/null 2>&1; then
  cp "$TH_DIR"/animations/*.fbx public/animations/
  echo "  ✓ public/animations/ ($(ls public/animations/*.fbx | wc -l | tr -d ' ') FBX files)"
else
  echo "  ⚠ No FBX animations found in TalkingHead repo."
  echo "    → Check the TalkingHead README for animation sources (Mixamo)"
  echo "    → Place FBX files in public/animations/"
fi

# ── Node dependencies ─────────────────────────────────────────────────────────
echo ""
echo "Installing server dependencies..."
cd server && npm install
cd ..

echo ""
echo "=== Setup complete ==="
echo ""
echo "  Start: node server/server.js"
echo "  Open:  http://localhost:3000  (Chrome recommended)"
echo ""

# ── Quick sanity check ────────────────────────────────────────────────────────
MISSING=0

if [ ! -f "public/modules/talkinghead.mjs" ]; then
  echo "  ⚠ WARNING: public/modules/talkinghead.mjs not found"
  MISSING=1
fi

if ! ls public/avatars/*.glb >/dev/null 2>&1; then
  echo "  ⚠ WARNING: No GLB avatar in public/avatars/ — app will fail to load avatar"
  MISSING=1
fi

if [ -z "$ELEVENLABS_VOICE_ID" ]; then
  # Try reading from .env
  if ! grep -q "^ELEVENLABS_VOICE_ID=" .env 2>/dev/null; then
    echo "  ⚠ WARNING: ELEVENLABS_VOICE_ID not set in .env"
    MISSING=1
  fi
fi

if [ "$MISSING" -eq 0 ]; then
  echo "  ✓ All checks passed"
fi
