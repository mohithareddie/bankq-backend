/* ========================================
   BANKQ BACKEND SERVER
   Express + MySQL + JWT + OTP Auth
   ======================================== */

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');
//const { initializeDatabase, getDB } = require('./config/db');
//const authRoutes = require('./routes/authRoutes');

//const admin = require("firebase-admin");
//let firebaseReady = false;
//try {
  //const serviceAccount = require("./config/serviceAccountKey.json");
  //admin.initializeApp({
    //credential: admin.credential.cert(serviceAccount)
  //});
  //firebaseReady = true;
  //console.log('🔥 Firebase Admin initialized');
//} catch (err) {
  //console.log('🔥 Firebase Admin init skipped:', err.message);
//}

// Load environment variables (must be before Twilio init)
dotenv.config();

// ---- FCM Push Notification ----
async function sendNotification(token, customTitle, customBody) {
  if (!token) return;
  if (!firebaseReady) {
    console.log(`🔔 [FCM SIMULATION] Title: ${customTitle || 'BankQ Alert'} | Body: ${customBody || 'Notification'}`);
    return;
  }
  try {
    const message = {
      notification: {
        title: customTitle || "BankQ Alert",
        body: customBody || "Your token is now being served. Please proceed to the counter."
      },
      token: token
    };
    await admin.messaging().send(message);
    console.log('🔔 FCM push notification sent');
  } catch (err) {
    console.error('❌ FCM push error:', err.message);
  }
}

// ---- Twilio SMS Notification ----
let twilioClient = null;
try {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (sid && token && sid.startsWith('AC')) {
    twilioClient = require('twilio')(sid, token);
    console.log('📱 Twilio SMS initialized');
  } else {
    console.log('📱 Twilio not configured — SMS will run in simulation mode');
  }
} catch (err) {
  console.log('📱 Twilio init skipped:', err.message);
}

async function sendSMS(phone) {
  if (!phone) return;
  if (!twilioClient) {
    console.log(`📱 [SMS SIMULATION] To: ${phone} | Your queue turn is near. Please be ready.`);
    return;
  }
  try {
    await twilioClient.messages.create({
      body: 'Your queue turn is near. Please be ready.',
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone.startsWith('+') ? phone : `+91${phone}`
    });
    console.log(`📱 SMS sent to ${phone}`);
  } catch (err) {
    console.error('❌ Twilio SMS error:', err.message);
  }
}

const app = express();
const PORT = process.env.PORT || 5000;

app.get("/", (req, res) => {
  res.send("BankQ Backend is running 🚀");
});

// ---- MIDDLEWARE ----
app.use(cors());                              // Enable CORS for frontend
app.use(express.json());                      // Parse JSON request bodies
app.use(express.urlencoded({ extended: true }));

// ---- REQUEST LOGGER (for debugging) ----
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.url}`);
  next();
});

// ---- ROUTES ----
//app.use('/api/auth', authRoutes);
app.post("/api/save-token", (req, res) => {
  const { token, userId } = req.body;

  if (!token) {
    return res.status(400).send("Token missing");
  }

  const db = getDB();

  if (userId) {
    // Save token for a specific user
    const query = "UPDATE users SET fcm_token = ? WHERE id = ?";
    db.query(query, [token, userId], (err, result) => {
      if (err) {
        console.error("DB Error:", err);
        return res.status(500).send("Database error");
      }
      console.log("✅ FCM token saved for user:", userId);
      res.send("Token saved successfully");
    });
  } else {
    // Token received but no user is logged in. Do nothing.
    // Token is saved in localStorage and will be sent during login.
    res.send("Token temporarily held on client.");
  }
});
// ✅ TEST NOTIFICATION ROUTE
app.get("/test-notification", async (req, res) => {
  try {
    await sendNotification("USER_FCM_TOKEN_HERE"); // replace later
    res.send("✅ Notification sent");
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send("❌ Failed");
  }
});

app.post('/api/location/save', async (req, res) => {
  try {
    const { userId, latitude, longitude } = req.body;
    if (!userId || !latitude || !longitude) {
      return res.status(400).json({ error: 'Missing location parameters' });
    }

    const db = getDB();
    await db.query(`
      INSERT INTO location_searches (user_id, latitude, longitude)
      VALUES (?, ?, ?)
    `, [userId, latitude, longitude]);

    res.json({ success: true, message: 'Location saved successfully' });
  } catch (error) {
    console.error('Error saving location:', error);
    res.status(500).json({ error: 'Error saving location' });
  }
});

// ---- NEARBY BANKS: Nominatim + Overpass API (FREE, no key needed) ----
app.get('/api/nearby-banks', async (req, res) => {
  try {
    const { bankName, location } = req.query;

    if (!bankName || !location) {
      return res.status(400).json({
        error: 'Missing parameters: bankName and location are required'
      });
    }

    console.log(`🔍 Searching for "${bankName}" near "${location}"...`);

    // Step 1: Convert location text → latitude/longitude using Nominatim
    const nominatimUrl = 'https://nominatim.openstreetmap.org/search';
    const geoResponse = await axios.get(nominatimUrl, {
      params: {
        q: location,
        format: 'json',
        limit: 1
      },
      headers: {
        'User-Agent': 'BankQ-App/1.0 (student-project)'
      }
    });

    if (!geoResponse.data || geoResponse.data.length === 0) {
      return res.status(404).json({
        error: 'Location not found. Please enter a valid city or area name.'
      });
    }

    // Round to 4 decimal places for location grouping consistency
    const latitude = Math.round(parseFloat(geoResponse.data[0].lat) * 10000) / 10000;
    const longitude = Math.round(parseFloat(geoResponse.data[0].lon) * 10000) / 10000;
    const displayName = geoResponse.data[0].display_name;
    const areaKey = `${latitude}_${longitude}`;

    console.log(`📍 Geocoded "${location}" → lat: ${latitude}, lon: ${longitude} (area: ${areaKey})`);

    // Step 2: Query Overpass API for nearby bank branches
    const overpassUrl = 'https://overpass-api.de/api/interpreter';
    const overpassQuery = `
      [out:json][timeout:30];
      node
        ["amenity"="bank"]
        ["name"~"${bankName}", i]
        (around:5000, ${latitude}, ${longitude});
      out body;
    `;

    console.log(`🏦 Overpass query for "${bankName}" within 5km...`);

    const overpassResponse = await axios.get(overpassUrl, {
      params: {
        data: overpassQuery
      },
      timeout: 20000
    });

    const elements = overpassResponse.data.elements || [];

    // Step 3: Build clean JSON response with Google Maps-style addresses
    const buildAddress = (tags) => {
      // If a full address exists, use it directly
      if (tags['addr:full']) return tags['addr:full'];

      // Build a structured address from individual OSM tags
      const parts = [];
      if (tags['addr:housenumber']) parts.push(tags['addr:housenumber']);
      if (tags['addr:street']) parts.push(tags['addr:street']);
      if (tags['addr:suburb'] || tags['addr:neighbourhood']) {
        parts.push(tags['addr:suburb'] || tags['addr:neighbourhood']);
      }
      if (tags['addr:city'] || tags['addr:district']) {
        parts.push(tags['addr:city'] || tags['addr:district']);
      }
      if (tags['addr:postcode']) parts.push(tags['addr:postcode']);

      if (parts.length > 0) return parts.join(', ');

      // Last resort: use any available location hint
      return tags['addr:place'] || tags['description'] || '';
    };

    const branches = elements
      .filter(el => el.tags && el.tags.name && el.lat && el.lon)
      .map(el => ({
        name: el.tags.name,
        latitude: el.lat,
        longitude: el.lon,
        address: buildAddress(el.tags),
        phone: el.tags.phone || el.tags['contact:phone'] || '',
        openingHours: el.tags.opening_hours || '',
        operator: el.tags.operator || ''
      }));

    console.log(`✅ Found ${branches.length} "${bankName}" branches near "${location}"`);

    res.json({
      success: true,
      bankName: bankName,
      location: displayName,
      coordinates: { latitude, longitude },
      total: branches.length,
      branches: branches
    });

  } catch (error) {
    console.error('❌ Nearby banks error:', error.message);
    res.status(500).json({
      error: 'Failed to fetch nearby banks',
      details: error.message
    });
  }
});

// ---- QUEUE SMS/EMAIL NOTIFICATION ----
app.post('/api/queue/notify', async (req, res) => {
  try {
    const { email, userName, tokenId, branchName, serviceName, position, type, message } = req.body;

    if (!email || !tokenId) {
      return res.status(400).json({ error: 'Missing email or tokenId' });
    }

    const { sendOTPEmail, isEmailReady } = require('./config/mailer');

    // Build notification email
    const subjects = {
      approaching: `🔔 BankQ: Your turn is approaching — Token ${tokenId}`,
      urgent: `🚨 BankQ URGENT: You are NEXT — Token ${tokenId}`,
      serving: `🎉 BankQ: Your turn is NOW — Token ${tokenId}`
    };

    const nodemailer = require('nodemailer');
    const dotenv = require('dotenv');
    dotenv.config();

    if (process.env.EMAIL_USER && process.env.EMAIL_PASS &&
      process.env.EMAIL_USER !== 'your_gmail@gmail.com') {

      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        tls: { rejectUnauthorized: false }
      });

      await transporter.sendMail({
        from: `"BankQ Alerts" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: subjects[type] || `BankQ Queue Update — Token ${tokenId}`,
        text: message,
        html: `
          <div style="font-family:Arial; padding:20px; max-width:460px; margin:0 auto; background:#ffffff; border-radius:16px; border:1px solid #e5e7eb;">
            <h2 style="text-align:center; color:#1a1a2e;">🏦 BankQ Queue Alert</h2>
            <p style="color:#374151; font-size:15px;">Hello <strong>${userName || 'Customer'}</strong>,</p>
            <div style="background:#f3f4f6; border-radius:12px; padding:16px; margin:16px 0; text-align:center;">
              <div style="font-size:14px; color:#6b7280; margin-bottom:8px;">Token Number</div>
              <div style="font-size:28px; font-weight:bold; color:#5046E4; font-family:monospace;">${tokenId}</div>
            </div>
            <p style="color:#374151; font-size:15px; text-align:center; font-weight:600;">${message}</p>
            <hr style="border:none; border-top:1px solid #e5e7eb; margin:20px 0;">
            <table style="width:100%; font-size:13px; color:#6b7280;">
              <tr><td style="padding:4px 0;">📍 Branch:</td><td style="text-align:right; font-weight:600;">${branchName || '—'}</td></tr>
              <tr><td style="padding:4px 0;">🏷️ Service:</td><td style="text-align:right; font-weight:600;">${serviceName || '—'}</td></tr>
              <tr><td style="padding:4px 0;">👥 Position:</td><td style="text-align:right; font-weight:600;">${position === 0 ? 'Your Turn!' : position + ' ahead'}</td></tr>
            </table>
            <p style="color:#9ca3af; font-size:11px; text-align:center; margin-top:16px;">This is an automated alert from BankQ. Do not reply.</p>
          </div>
        `
      });

      console.log(`📧 Queue email sent to ${email} (${type}) for Token ${tokenId}`);
    } else {
      // No email config — log to console as fallback
      console.log(`📧 [EMAIL SIMULATION] To: ${email} | ${message}`);
    }

    // ---- FCM Push Notification to phone top bar ----
    try {
      const db = getDB();
      const [users] = await db.query('SELECT fcm_token, phone_number FROM users WHERE email = ?', [email]);
      if (users.length > 0) {
        const user = users[0];

        // Determine push notification title and body based on type
        let pushTitle = 'Queue Alert';
        let pushBody = 'Your turn is coming soon';
        if (type === 'serving') {
          pushTitle = 'Now Serving';
          pushBody = 'Please proceed to counter';
        } else if (type === 'urgent') {
          pushTitle = 'Queue Alert';
          pushBody = 'Your turn is coming in 5 minutes';
        } else if (type === 'approaching') {
          pushTitle = 'Queue Alert';
          pushBody = `${position} people ahead. Your turn is coming soon.`;
        }

        // Send FCM push notification (shows on phone top bar via service worker)
        if (user.fcm_token) {
          await sendNotification(user.fcm_token, pushTitle, pushBody);
        }

        // Send SMS notification
        const phoneNumber = user.phone_number || req.body.phone;
        if (phoneNumber) {
          await sendSMS(phoneNumber);
        }
      }
    } catch (notifErr) {
      console.error('❌ Push/SMS notification error:', notifErr.message);
    }

    res.json({ success: true, message: 'Notification sent (email + push + SMS)' });

  } catch (error) {
    console.error('❌ Queue notification error:', error.message);
    res.status(500).json({ error: 'Failed to send notification', details: error.message });
  }
});

// ---- HEALTH CHECK ----
app.get('/', (req, res) => {
  res.json({
    message: '🏦 BankQ Backend is running!',
    database: process.env.DB_NAME || 'bankq_db',
    endpoints: {
      register: 'POST /api/auth/register',
      login: 'POST /api/auth/login',
      verifyOTP: 'POST /api/auth/verify-otp',
      resendOTP: 'POST /api/auth/resend-otp',
      nearbyBanks: 'GET /api/nearby-banks?bankName=Axis Bank&location=Hyderabad'
    }
  });
});

// ---- START SERVER ----
async function startServer() {
  // Auto-create database + all tables (users, otp_tokens, sessions)
  await initializeDatabase();

  // Queue notifications are handled by the frontend QueueSimulator
  // which calls POST /api/queue/notify when a user's turn is approaching.
  // No server-side polling needed since queue state lives on the client.
  console.log('📡 Queue notifications: triggered by frontend via /api/queue/notify');

  app.listen(5000, '0.0.0.0', () => {
    console.log("Server running on all networks at http://192.168.1.5:5000");
    console.log('');
    console.log('========================================');
    console.log(`🏦 BankQ Backend Server`);
    console.log(`   Running on: http://localhost:${PORT}`);
    console.log(`   Database:   ${process.env.DB_NAME || 'bankq_db'}`);
    console.log(`   Notifications: Email ✔ | FCM Push ✔ | SMS ✔`);
    console.log('========================================');
    console.log('');
    console.log('Available API endpoints:');
    console.log(`  POST http://localhost:${PORT}/api/auth/register`);
    console.log(`  POST http://localhost:${PORT}/api/auth/login`);
    console.log(`  POST http://localhost:${PORT}/api/auth/verify-otp`);
    console.log(`  POST http://localhost:${PORT}/api/auth/resend-otp`);
    console.log(`  GET  http://localhost:${PORT}/api/nearby-banks?bankName=Axis+Bank&location=Hyderabad`);
    console.log('');
  });
}

startServer();
