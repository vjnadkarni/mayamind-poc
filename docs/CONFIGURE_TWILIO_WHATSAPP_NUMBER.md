# Configure Twilio WhatsApp Business Number

This guide walks through setting up a production WhatsApp Business number for MayaMind using Twilio. A production number eliminates the 72-hour sandbox opt-in requirement.

## Prerequisites

- Twilio account ([console.twilio.com](https://console.twilio.com))
- Meta Business account ([business.facebook.com](https://business.facebook.com))
- A phone number dedicated to MayaMind (Twilio number recommended)
- MayaMind server deployed with a public URL (e.g., `https://companion.mayamind.ai`)

## Overview

| Step | Description | Time |
|------|-------------|------|
| 1 | Purchase a Twilio phone number | 5 min |
| 2 | Register as WhatsApp Sender | 15-30 min |
| 3 | Configure webhook | 5 min |
| 4 | Update server environment | 5 min |

**Total time:** ~30-45 minutes (plus Meta approval, usually instant to 24 hours)

---

## Step 1: Purchase a Twilio Phone Number

1. Go to **Twilio Console** → **Phone Numbers** → **Manage** → **Buy a number**
   - Or: [console.twilio.com/us1/develop/phone-numbers/manage/search](https://console.twilio.com/us1/develop/phone-numbers/manage/search)

2. Search for a number with **SMS** and **Voice** capabilities

3. Purchase the number (e.g., `+13412014043`)

4. Note the number — you'll need it for WhatsApp registration

**Cost:** ~$1-2/month for a US number

**Important:** Do NOT use your personal or business mobile number. Once registered with WhatsApp Business API, that number can no longer use regular WhatsApp on a phone.

---

## Step 2: Register as WhatsApp Sender

### 2.1 Navigate to WhatsApp Senders

1. Go to **Twilio Console** → **Messaging** → **Senders** → **WhatsApp Senders**
   - Or search for "WhatsApp Senders" in the console search bar

2. Click **"Create New Sender"** (or "Add WhatsApp Sender")

### 2.2 Select Phone Number

1. Choose **"Twilio phone number"**
2. Select your purchased number from the dropdown
3. Click **Continue**

### 2.3 Connect Meta Business Account

1. Click **"Continue with Facebook"**
2. Log into your Meta/Facebook account
3. Select or create a Meta Business account for MayaMind
4. Grant the requested permissions

### 2.4 Configure WhatsApp Business Profile

1. Select **"Use a new or existing WhatsApp number"** (not "display name only")
2. Enter your Twilio number if prompted
3. Set your **Display Name** (e.g., "MayaMind")
   - This is what recipients will see when they receive messages

### 2.5 Verify Phone Number

WhatsApp needs to verify you control the phone number. Since it's a Twilio number, you'll need to access the verification code through Twilio.

#### Option A: Set up SMS Forwarding (Recommended)

Before requesting the verification code, set up forwarding so you receive the code on your personal phone:

1. **Create a Studio Flow:**
   - Search for **"Studio"** in Twilio Console
   - Click **Studio** → **Create a Flow**
   - Name it `Forward SMS`
   - Select **"Start from scratch"** → Next

2. **Configure the Flow:**
   - Drag **"Send Message"** widget from the right panel onto the canvas
   - Connect **"Incoming Message"** (from Trigger) to the **"Send Message"** widget
   - Click on the Send Message widget and configure:
     - **Message To:** `+1XXXXXXXXXX` (your personal phone number)
     - **Message Body:** `Fwd from {{trigger.message.From}}: {{trigger.message.Body}}`
   - Leave other fields as defaults
   - Click **Save**, then **Publish**

3. **Assign Flow to Phone Number:**
   - Go to **Phone Numbers** → **Manage** → **Active Numbers**
   - Click on your Twilio number
   - Under **Messaging** → "A message comes in":
     - Select **Studio Flow**
     - Select **Forward SMS**
   - Click **Save Configuration**

4. **Request Verification Code:**
   - Return to the WhatsApp registration page
   - Select **"Text message"** for verification
   - The code will be forwarded to your personal phone
   - Enter the 6-digit code

#### Option B: Check Twilio Logs Directly

If you prefer not to set up forwarding:

1. Request the verification code via **"Text message"**
2. Go to **Twilio Console** → **Monitor** → **Logs** → **Messaging**
3. Look for an incoming message to your Twilio number
4. Click on it to view the verification code
5. Enter the code in the registration form

### 2.6 Complete Registration

After entering the verification code:

1. A popup will confirm: "Your account is connected to Twilio"
2. Meta will review your business (usually instant, up to 24 hours)
3. Check status in **WhatsApp Senders** — look for "Online" with a green checkmark

---

## Step 3: Configure Webhook for Incoming Messages

Once the number is approved (shows "Online"):

1. Go to **Twilio Console** → **Messaging** → **Senders** → **WhatsApp Senders**

2. Click on your number (e.g., `+13412014043`)

3. Find **"Messaging Endpoint Configuration"** section

4. Set **Webhook URL for incoming messages**:
   ```
   https://companion.mayamind.ai/api/whatsapp/webhook
   ```

5. Ensure method is **POST**

6. Leave Fallback URL and Status callback URL empty (optional)

7. Click **Save**

---

## Step 4: Update Server Environment

### 4.1 Update .env on the Server

```bash
ssh root@YOUR_VPS_IP
sudo nano /var/www/mayamind/.env
```

Update the Twilio WhatsApp number:
```env
TWILIO_WHATSAPP_NUMBER=whatsapp:+13412014043
```

Also update the webhook URL if not already set:
```env
NGROK_URL=https://companion.mayamind.ai
```

### 4.2 Restart the Server

```bash
sudo systemctl restart mayamind
```

### 4.3 Verify

```bash
sudo systemctl status mayamind
```

Look for `Twilio: configured` in the startup output.

---

## Step 5: Test Two-Way Messaging

### Test Outbound (MayaMind → User)

1. Go to `https://companion.mayamind.ai/dashboard/`
2. Navigate to the **Connect** section
3. Send a message via Maya's voice interface
4. Verify the message arrives on the recipient's WhatsApp

### Test Inbound (User → MayaMind)

1. From the recipient's phone, reply to the MayaMind message
2. Verify Maya announces the incoming message
3. Check the server logs if issues occur:
   ```bash
   sudo journalctl -u mayamind -f
   ```

---

## Troubleshooting

### Verification Code Not Arriving

- Ensure Studio Flow is published (not just saved)
- Verify the phone number is configured to use the Studio Flow
- Check **Monitor** → **Logs** → **Messaging** for incoming messages
- Try phone call verification instead of SMS

### Messages Not Delivering (Outbound)

- Check server logs: `sudo journalctl -u mayamind -n 50`
- Verify `TWILIO_WHATSAPP_NUMBER` in `.env` matches your registered number
- Ensure the number shows "Online" in WhatsApp Senders

### Messages Not Receiving (Inbound)

- Verify webhook URL is set correctly in WhatsApp Senders
- Check that the URL is `https://` (not `http://`)
- Verify server is reachable: `curl https://companion.mayamind.ai/api/whatsapp/webhook`
- Check server logs for incoming webhook attempts

### "User has not opted in" Error

This happens with the sandbox number, not production numbers. If you see this:
- Verify you're using the production number, not the sandbox
- Check that `TWILIO_WHATSAPP_NUMBER` in `.env` is correct

---

## WhatsApp Business Messaging Rules

### Conversation Windows

- **User-initiated:** When a user messages your business first, you have a 24-hour window to send free-form messages
- **Business-initiated:** To message users first (outside the 24-hour window), you need approved **Message Templates**

### Message Templates (Optional)

For proactive notifications (e.g., daily reminders), you'll need to create Message Templates:

1. Go to **Twilio Console** → **Messaging** → **Content Template Builder**
2. Create templates for common use cases
3. Submit for Meta approval (usually 24-48 hours)
4. Use the template SID when sending business-initiated messages

For MayaMind's current use case (conversational messaging initiated by seniors), templates are not required.

---

## Cleanup (Optional)

After successful verification, you can remove the SMS forwarding flow:

1. **Reset Phone Number Webhook:**
   - Go to **Phone Numbers** → **Active Numbers** → your number
   - Under **Messaging**, change from "Studio Flow" to "Webhook"
   - Set to default or leave blank
   - Save

2. **Delete Studio Flow:**
   - Go to **Studio** → **Flows**
   - Delete the "Forward SMS" flow

---

## Cost Summary

| Item | Cost |
|------|------|
| Twilio Phone Number | ~$1-2/month |
| WhatsApp Messages (User-initiated) | ~$0.005/conversation |
| WhatsApp Messages (Business-initiated) | ~$0.01-0.08/conversation |

WhatsApp uses a per-conversation pricing model (24-hour windows), not per-message.

---

## Reference Links

- [Twilio WhatsApp Quickstart](https://www.twilio.com/docs/whatsapp/quickstart)
- [WhatsApp Business API Pricing](https://www.twilio.com/whatsapp/pricing)
- [Meta Business Verification](https://www.facebook.com/business/help/2058515294227817)
- [WhatsApp Message Templates](https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates)
