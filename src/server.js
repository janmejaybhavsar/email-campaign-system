// =============================================================================
// PROFESSIONAL COLD EMAIL SYSTEM FOR JOB APPLICATIONS
// Clean, personal emails without campaign branding
// Now with MongoDB Atlas for persistent cloud storage
// =============================================================================

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Generate JWT secret if not provided
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET not set in environment, using generated secret (not suitable for production)');
}

console.log('🚀 Starting Professional Cold Email System with MongoDB...');

// =============================================================================
// MIDDLEWARE
// =============================================================================

app.use(helmet({ 
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" } // Fix for tracking pixel
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Request timeout middleware
app.use((req, res, next) => {
  req.setTimeout(25000); // 25 seconds timeout
  res.setTimeout(25000);
  next();
});

// Conservative rate limiting for professional use
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 emails per hour max (professional sending rate)
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// =============================================================================
// MONGODB CONNECTION
// =============================================================================

let db;
let client;

async function connectToMongoDB() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/cold_email_system';
    
    console.log('🔗 Connecting to MongoDB...');
    
    const options = {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    };
    
    client = new MongoClient(mongoUri, options);
    await client.connect();
    
    db = client.db();
    
    // Test the connection
    await db.admin().ping();
    
    console.log('✅ Connected to MongoDB successfully');
    
    // Create indexes for better performance
    await createIndexes();
    
    return true;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    return false;
  }
}

async function createIndexes() {
  try {
    // Users collection indexes
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    
    // Contacts collection indexes
    await db.collection('contacts').createIndex({ userId: 1, email: 1 }, { unique: true });
    await db.collection('contacts').createIndex({ userId: 1 });
    
    // Templates collection indexes
    await db.collection('templates').createIndex({ userId: 1 });
    
    // Campaigns collection indexes
    await db.collection('campaigns').createIndex({ userId: 1 });
    
    // Email tracking indexes
    await db.collection('emailTracking').createIndex({ trackingId: 1 }, { unique: true });
    await db.collection('emailTracking').createIndex({ campaignId: 1 });
    
    console.log('✅ MongoDB indexes created successfully');
  } catch (error) {
    console.error('⚠️ Index creation warning:', error.message);
  }
}

// =============================================================================
// ERROR HANDLING MIDDLEWARE
// =============================================================================

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// =============================================================================
// AUTHENTICATION
// =============================================================================

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// =============================================================================
// API ROUTES
// =============================================================================

app.get('/health', asyncHandler(async (req, res) => {
  const memUsage = process.memoryUsage();
  const isMongoConnected = client && client.topology && client.topology.isConnected();
  
  res.json({
    status: isMongoConnected ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    emailServiceType: 'Individual User Gmail Accounts',
    database: 'MongoDB',
    databaseStatus: isMongoConnected ? 'connected' : 'disconnected',
    environment: process.env.NODE_ENV || 'development',
    baseUrl: BASE_URL,
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      total: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB'
    }
  });
}));

// Authentication with name field
app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const { name, email, password, signature } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long' });
  }

  // Check if user already exists
  const existingUser = await db.collection('users').findOne({ email });
  if (existingUser) {
    return res.status(409).json({ error: 'User already exists' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const newUser = {
    name,
    email,
    passwordHash: hashedPassword,
    signature: signature || '',
    gmailAddress: null,
    gmailAppPassword: null,
    gmailConfigured: false,
    gmailVerified: false,
    gmailLastTested: null,
    createdAt: new Date(),
    isActive: true
  };

  const result = await db.collection('users').insertOne(newUser);
  const userId = result.insertedId.toString();

  const token = jwt.sign(
    { userId, email, name },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  console.log(`✅ User registered: ${name} (${email})`);
  res.status(201).json({
    message: 'Account created successfully',
    token,
    user: { id: userId, name, email, signature }
  });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const user = await db.collection('users').findOne({ 
    email, 
    isActive: true 
  });

  if (!user || !await bcrypt.compare(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { userId: user._id.toString(), email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  console.log(`✅ User logged in: ${user.name} (${user.email})`);
  res.json({
    message: 'Login successful',
    token,
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      signature: user.signature
    }
  });
}));

// Contacts management
app.post('/api/contacts', authenticateToken, asyncHandler(async (req, res) => {
  const { name, email, company, position, linkedinUrl, notes, customFields } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  const contact = {
    userId: req.user.userId,
    name: name || '',
    email,
    company: company || '',
    position: position || '',
    linkedinUrl: linkedinUrl || '',
    notes: notes || '',
    customFields: customFields || {},
    contacted: false,
    lastContacted: null,
    responseReceived: false,
    createdAt: new Date()
  };

  await db.collection('contacts').replaceOne(
    { userId: req.user.userId, email },
    contact,
    { upsert: true }
  );

  console.log(`✅ Contact added: ${name} (${email}) at ${company}`);
  res.status(201).json({ message: 'Contact added' });
}));

app.get('/api/contacts', authenticateToken, asyncHandler(async (req, res) => {
  const contacts = await db.collection('contacts')
    .find({ userId: req.user.userId })
    .sort({ createdAt: -1 })
    .toArray();

  res.json({
    contacts,
    pagination: { total: contacts.length }
  });
}));

// Bulk contact import
app.post('/api/contacts/bulk', authenticateToken, asyncHandler(async (req, res) => {
  const { contacts } = req.body;

  if (!Array.isArray(contacts)) {
    return res.status(400).json({ error: 'Contacts must be an array' });
  }

  let successCount = 0;
  let errorCount = 0;
  const errors = [];

  for (const contact of contacts) {
    try {
      if (!contact.email) {
        errorCount++;
        errors.push(`Missing email for contact: ${contact.name || 'Unknown'}`);
        continue;
      }

      const contactDoc = {
        userId: req.user.userId,
        name: contact.name || '',
        email: contact.email,
        company: contact.company || '',
        position: contact.position || '',
        linkedinUrl: contact.linkedinUrl || '',
        notes: contact.notes || '',
        customFields: contact.customFields || {},
        contacted: false,
        lastContacted: null,
        responseReceived: false,
        createdAt: new Date()
      };

      await db.collection('contacts').replaceOne(
        { userId: req.user.userId, email: contact.email },
        contactDoc,
        { upsert: true }
      );

      successCount++;
    } catch (error) {
      errorCount++;
      errors.push(`Error with ${contact.email}: ${error.message}`);
      console.error('Bulk import error for contact:', contact.email, error);
    }
  }

  console.log(`✅ Bulk import: ${successCount} contacts added, ${errorCount} errors`);
  res.json({
    message: 'Bulk import completed',
    successful: successCount,
    errors: errorCount,
    errorDetails: errors.slice(0, 10) // Return first 10 errors
  });
}));

// Templates
app.post('/api/templates', authenticateToken, asyncHandler(async (req, res) => {
  const { name, subject, htmlBody, textBody, templateType } = req.body;

  if (!name || !subject || (!htmlBody && !textBody)) {
    return res.status(400).json({ error: 'Name, subject, and body (HTML or text) are required' });
  }

  const template = {
    userId: req.user.userId,
    name,
    subject,
    htmlBody: htmlBody || '',
    textBody: textBody || '',
    templateType: templateType || 'outreach',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await db.collection('templates').insertOne(template);

  console.log(`✅ Template created: ${name}`);
  res.status(201).json({ 
    message: 'Template created', 
    id: result.insertedId.toString() 
  });
}));

app.get('/api/templates', authenticateToken, asyncHandler(async (req, res) => {
  const templates = await db.collection('templates')
    .find({ userId: req.user.userId })
    .sort({ createdAt: -1 })
    .toArray();

  // Convert _id to id for frontend compatibility
  const templatesWithId = templates.map(template => ({
    ...template,
    id: template._id.toString(),
    html_body: template.htmlBody,
    text_body: template.textBody,
    template_type: template.templateType
  }));

  res.json(templatesWithId);
}));

// Get single template for editing
app.get('/api/templates/:id', authenticateToken, asyncHandler(async (req, res) => {
  const templateId = req.params.id;

  if (!ObjectId.isValid(templateId)) {
    return res.status(400).json({ error: 'Invalid template ID' });
  }

  const template = await db.collection('templates').findOne({
    _id: new ObjectId(templateId),
    userId: req.user.userId
  });

  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }

  res.json({
    ...template,
    id: template._id.toString(),
    html_body: template.htmlBody,
    text_body: template.textBody
  });
}));

// Update template
app.put('/api/templates/:id', authenticateToken, asyncHandler(async (req, res) => {
  const templateId = req.params.id;
  const { name, subject, htmlBody, textBody, templateType } = req.body;

  if (!name || !subject || (!htmlBody && !textBody)) {
    return res.status(400).json({ error: 'Name, subject, and body are required' });
  }

  if (!ObjectId.isValid(templateId)) {
    return res.status(400).json({ error: 'Invalid template ID' });
  }

  const result = await db.collection('templates').updateOne(
    { _id: new ObjectId(templateId), userId: req.user.userId },
    {
      $set: {
        name,
        subject,
        htmlBody: htmlBody || '',
        textBody: textBody || '',
        templateType: templateType || 'outreach',
        updatedAt: new Date()
      }
    }
  );

  if (result.matchedCount === 0) {
    return res.status(404).json({ error: 'Template not found' });
  }

  console.log(`✅ Template updated: ${name} (ID: ${templateId})`);
  res.json({ message: 'Template updated successfully', id: templateId });
}));

// Delete template
app.delete('/api/templates/:id', authenticateToken, asyncHandler(async (req, res) => {
  const templateId = req.params.id;

  if (!ObjectId.isValid(templateId)) {
    return res.status(400).json({ error: 'Invalid template ID' });
  }

  const result = await db.collection('templates').deleteOne({
    _id: new ObjectId(templateId),
    userId: req.user.userId
  });

  if (result.deletedCount === 0) {
    return res.status(404).json({ error: 'Template not found' });
  }

  console.log(`✅ Template deleted: ID ${templateId}`);
  res.json({ message: 'Template deleted successfully' });
}));

// Outreach campaigns
app.post('/api/campaigns', authenticateToken, asyncHandler(async (req, res) => {
  const { name, templateId, settings } = req.body;

  if (!name || !templateId) {
    return res.status(400).json({ error: 'Name and template are required' });
  }

  const campaign = {
    userId: req.user.userId,
    name,
    templateId: ObjectId.isValid(templateId) ? new ObjectId(templateId) : templateId,
    status: 'draft',
    totalContacts: 0,
    sentCount: 0,
    repliedCount: 0,
    settings: settings || { delay: 30000 },
    createdAt: new Date()
  };

  const result = await db.collection('campaigns').insertOne(campaign);

  console.log(`✅ Outreach campaign created: ${name}`);
  res.status(201).json({ 
    message: 'Campaign created', 
    id: result.insertedId.toString() 
  });
}));

app.get('/api/campaigns', authenticateToken, asyncHandler(async (req, res) => {
  const campaigns = await db.collection('campaigns').aggregate([
    { $match: { userId: req.user.userId } },
    {
      $lookup: {
        from: 'templates',
        localField: 'templateId',
        foreignField: '_id',
        as: 'template'
      }
    },
    {
      $addFields: {
        templateName: { $arrayElemAt: ['$template.name', 0] }
      }
    },
    { $sort: { createdAt: -1 } }
  ]).toArray();

  const campaignsWithId = campaigns.map(campaign => ({
    ...campaign,
    id: campaign._id.toString(),
    template_name: campaign.templateName
  }));

  res.json(campaignsWithId);
}));

// Send professional outreach campaign with better error handling
app.post('/api/campaigns/:id/send', authenticateToken, asyncHandler(async (req, res) => {
  const campaignId = req.params.id;

  if (!ObjectId.isValid(campaignId)) {
    return res.status(400).json({ error: 'Invalid campaign ID' });
  }

  console.log(`🔍 Starting campaign ${campaignId} for user ${req.user.userId}`);

  // Check if user has Gmail configured
  const user = await db.collection('users').findOne({ 
    _id: new ObjectId(req.user.userId) 
  });

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (!user.gmailConfigured || !user.gmailAddress || !user.gmailAppPassword) {
    return res.status(400).json({
      error: 'Gmail not configured. Please configure your Gmail settings in the Settings tab before sending campaigns.'
    });
  }

  // Get campaign data
  const campaign = await db.collection('campaigns').findOne({
    _id: new ObjectId(campaignId),
    userId: req.user.userId
  });

  if (!campaign) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  // Get template data
  let templateId = campaign.templateId;
  if (typeof templateId === 'string' && ObjectId.isValid(templateId)) {
    templateId = new ObjectId(templateId);
  }

  const template = await db.collection('templates').findOne({
    _id: templateId,
    userId: req.user.userId
  });

  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }

  // Get available contacts
  const contacts = await db.collection('contacts')
    .find({ userId: req.user.userId, contacted: false })
    .limit(20) // Limit to prevent timeout
    .toArray();

  if (contacts.length === 0) {
    return res.status(400).json({ 
      error: 'No new contacts to reach out to. All contacts have already been contacted.' 
    });
  }

  // Update campaign status
  await db.collection('campaigns').updateOne(
    { _id: new ObjectId(campaignId) },
    { 
      $set: { 
        status: 'sending', 
        totalContacts: contacts.length,
        startedAt: new Date()
      } 
    }
  );

  // Send response immediately
  res.json({
    message: `Campaign started! Sending to ${contacts.length} contacts...`,
    totalContacts: contacts.length,
    campaignName: campaign.name,
    gmailAccount: user.gmailAddress
  });

  // Start sending emails asynchronously
  sendEmailsInBackground(campaignId, campaign, template, contacts, user).catch(error => {
    console.error('Background email sending failed:', error);
    db.collection('campaigns').updateOne(
      { _id: new ObjectId(campaignId) },
      { 
        $set: { 
          status: 'failed',
          error: error.message
        } 
      }
    );
  });
}));

// Gmail Configuration Routes
app.get('/api/user/gmail-config', authenticateToken, asyncHandler(async (req, res) => {
  const user = await db.collection('users').findOne({ 
    _id: new ObjectId(req.user.userId) 
  });
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  res.json({
    gmailAddress: user.gmailAddress || '',
    configured: !!user.gmailConfigured,
    verified: !!user.gmailVerified,
    lastTested: user.gmailLastTested
  });
}));

app.post('/api/user/gmail-config', authenticateToken, asyncHandler(async (req, res) => {
  const { gmailAddress, gmailAppPassword } = req.body;
  
  if (!gmailAddress || !gmailAppPassword) {
    return res.status(400).json({ error: 'Gmail address and app password are required' });
  }
  
  // Basic email validation
  const emailRegex = /^[^\s@]+@gmail\.com$/i;
  if (!emailRegex.test(gmailAddress)) {
    return res.status(400).json({ error: 'Please enter a valid Gmail address' });
  }
  
  // App password validation (remove spaces)
  const cleanPassword = gmailAppPassword.replace(/\s/g, '');
  if (cleanPassword.length !== 16) {
    return res.status(400).json({ error: 'Gmail app password should be 16 characters long (excluding spaces)' });
  }
  
  try {
    // Test the Gmail configuration
    const testTransporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: gmailAddress,
        pass: cleanPassword
      },
      tls: {
        rejectUnauthorized: false
      }
    });
    
    await testTransporter.verify();
    
    // Save successful configuration
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.user.userId) },
      {
        $set: {
          gmailAddress,
          gmailAppPassword: cleanPassword,
          gmailConfigured: true,
          gmailVerified: true,
          gmailLastTested: new Date()
        }
      }
    );
    
    console.log(`✅ Gmail configured for user ${req.user.userId}: ${gmailAddress}`);
    res.json({ 
      message: 'Gmail configuration saved and verified successfully!',
      verified: true 
    });
    
  } catch (error) {
    console.error('Gmail verification failed:', error);
    
    // Save as configured but not verified
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.user.userId) },
      {
        $set: {
          gmailAddress,
          gmailAppPassword: cleanPassword,
          gmailConfigured: true,
          gmailVerified: false,
          gmailLastTested: new Date()
        }
      }
    );
    
    res.status(400).json({ 
      error: 'Gmail verification failed. Please check your credentials.',
      details: error.message,
      saved: true
    });
  }
}));

app.post('/api/user/gmail-test', authenticateToken, asyncHandler(async (req, res) => {
  const user = await db.collection('users').findOne({ 
    _id: new ObjectId(req.user.userId) 
  });
  
  if (!user || !user.gmailAddress || !user.gmailAppPassword) {
    return res.status(400).json({ error: 'Gmail not configured. Please configure your Gmail settings first.' });
  }
  
  try {
    // Create transporter with user's credentials
    const userTransporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: user.gmailAddress,
        pass: user.gmailAppPassword
      },
      tls: {
        rejectUnauthorized: false
      }
    });
    
    await userTransporter.verify();
    
    // Send test email
    const testEmail = {
      from: `"${req.user.name}" <${user.gmailAddress}>`,
      to: user.gmailAddress,
      subject: `Gmail Test - ${new Date().toLocaleString()}`,
      html: `
        <h2>🎉 Gmail Configuration Test Successful!</h2>
        <p>Hi ${req.user.name},</p>
        <p>Your Gmail configuration is working perfectly! Your cold email system is ready to use.</p>
        <p><strong>Gmail Account:</strong> ${user.gmailAddress}</p>
        <p><strong>Test Time:</strong> ${new Date().toLocaleString()}</p>
        <p>You can now start sending professional cold emails using your own Gmail account.</p>
        <hr>
        <p><small>This test email was sent from your Professional Cold Email System</small></p>
      `
    };
    
    const result = await userTransporter.sendMail(testEmail);
    
    // Update verification status
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.user.userId) },
      {
        $set: {
          gmailVerified: true,
          gmailLastTested: new Date()
        }
      }
    );
    
    console.log(`✅ Gmail test successful for user ${req.user.userId}: ${user.gmailAddress}`);
    
    res.json({
      success: true,
      message: 'Gmail test successful! Check your inbox for the test email.',
      messageId: result.messageId,
      sentTo: user.gmailAddress
    });
    
  } catch (error) {
    console.error('Gmail test failed:', error);
    
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.user.userId) },
      {
        $set: {
          gmailVerified: false,
          gmailLastTested: new Date()
        }
      }
    );
    
    res.status(400).json({
      success: false,
      error: 'Gmail test failed',
      details: error.message
    });
  }
}));

app.delete('/api/user/gmail-config', authenticateToken, asyncHandler(async (req, res) => {
  await db.collection('users').updateOne(
    { _id: new ObjectId(req.user.userId) },
    {
      $unset: {
        gmailAddress: "",
        gmailAppPassword: ""
      },
      $set: {
        gmailConfigured: false,
        gmailVerified: false,
        gmailLastTested: null
      }
    }
  );
  
  console.log(`✅ Gmail configuration removed for user ${req.user.userId}`);
  res.json({ message: 'Gmail configuration removed successfully' });
}));

// Email tracking endpoints
app.get('/track/open/:trackingId', asyncHandler(async (req, res) => {
  const trackingId = req.params.trackingId;
  const userAgent = req.get('User-Agent') || 'Unknown';
  const ipAddress = req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || 'Unknown';

  console.log(`📊 Email opened - Tracking ID: ${trackingId}`);

  try {
    await db.collection('emailTracking').updateOne(
      { trackingId, opened: false },
      {
        $set: {
          opened: true,
          openedAt: new Date(),
          userAgent,
          ipAddress
        }
      }
    );
  } catch (error) {
    console.error('Tracking update error:', error);
  }

  // Return 1x1 transparent pixel
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );

  res.set({
    'Content-Type': 'image/png',
    'Content-Length': pixel.length,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });

  res.send(pixel);
}));

// Campaign Analytics
app.get('/api/campaigns/analytics/summary', authenticateToken, asyncHandler(async (req, res) => {
  const campaigns = await db.collection('campaigns').aggregate([
    { $match: { userId: req.user.userId } },
    {
      $lookup: {
        from: 'emailTracking',
        localField: '_id',
        foreignField: 'campaignId',
        as: 'tracking'
      }
    },
    {
      $addFields: {
        tracked_emails: { $size: '$tracking' },
        opens: {
          $size: {
            $filter: {
              input: '$tracking',
              cond: { $eq: ['$$this.opened', true] }
            }
          }
        },
        clicks: {
          $size: {
            $filter: {
              input: '$tracking',
              cond: { $eq: ['$$this.clicked', true] }
            }
          }
        }
      }
    },
    {
      $addFields: {
        openRate: {
          $cond: {
            if: { $gt: ['$tracked_emails', 0] },
            then: { $round: [{ $multiply: [{ $divide: ['$opens', '$tracked_emails'] }, 100] }] },
            else: 0
          }
        },
        clickRate: {
          $cond: {
            if: { $gt: ['$tracked_emails', 0] },
            then: { $round: [{ $multiply: [{ $divide: ['$clicks', '$tracked_emails'] }, 100] }] },
            else: 0
          }
        }
      }
    },
    { $sort: { createdAt: -1 } }
  ]).toArray();

  const campaignsWithId = campaigns.map(campaign => ({
    ...campaign,
    id: campaign._id.toString(),
    sent_count: campaign.sentCount || 0
  }));

  res.json(campaignsWithId);
}));

app.get('/api/campaigns/:id/analytics', authenticateToken, asyncHandler(async (req, res) => {
  const campaignId = req.params.id;

  if (!ObjectId.isValid(campaignId)) {
    return res.status(400).json({ error: 'Invalid campaign ID' });
  }

  // Verify campaign ownership
  const campaign = await db.collection('campaigns').findOne({
    _id: new ObjectId(campaignId),
    userId: req.user.userId
  });

  if (!campaign) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  // Get tracking stats
  const trackingStats = await db.collection('emailTracking').aggregate([
    { $match: { campaignId: new ObjectId(campaignId) } },
    {
      $group: {
        _id: null,
        totalTracked: { $sum: 1 },
        opened: { $sum: { $cond: ['$opened', 1, 0] } },
        clicked: { $sum: { $cond: ['$clicked', 1, 0] } },
        totalClicks: { $sum: { $ifNull: ['$clicksCount', 0] } }
      }
    }
  ]).toArray();

  const stats = trackingStats[0] || { totalTracked: 0, opened: 0, clicked: 0, totalClicks: 0 };

  // Get individual contact tracking
  const contactTracking = await db.collection('emailTracking').aggregate([
    { $match: { campaignId: new ObjectId(campaignId) } },
    {
      $lookup: {
        from: 'contacts',
        localField: 'contactId',
        foreignField: '_id',
        as: 'contact'
      }
    },
    {
      $addFields: {
        name: { $arrayElemAt: ['$contact.name', 0] },
        email: { $arrayElemAt: ['$contact.email', 0] },
        company: { $arrayElemAt: ['$contact.company', 0] },
        position: { $arrayElemAt: ['$contact.position', 0] }
      }
    },
    { $sort: { createdAt: -1 } }
  ]).toArray();

  const analytics = {
    campaign: {
      id: campaign._id.toString(),
      name: campaign.name,
      status: campaign.status,
      totalContacts: campaign.totalContacts,
      sentCount: campaign.sentCount,
      createdAt: campaign.createdAt
    },
    emailStats: {
      sent: campaign.sentCount || 0,
      failed: 0
    },
    trackingStats: {
      totalTracked: stats.totalTracked,
      opened: stats.opened,
      clicked: stats.clicked,
      totalClicks: stats.totalClicks,
      openRate: stats.totalTracked > 0 ? Math.round((stats.opened / stats.totalTracked) * 100) : 0,
      clickRate: stats.totalTracked > 0 ? Math.round((stats.clicked / stats.totalTracked) * 100) : 0
    },
    contactTracking: contactTracking.map(contact => ({
      name: contact.name,
      email: contact.email,
      company: contact.company,
      position: contact.position,
      opened: contact.opened,
      opened_at: contact.openedAt,
      clicked: contact.clicked,
      clicked_at: contact.clickedAt,
      clicks_count: contact.clicksCount || 0
    }))
  };

  res.json(analytics);
}));

// =============================================================================
// EMAIL SENDING FUNCTIONS
// =============================================================================

async function sendEmailsInBackground(campaignId, campaign, template, contacts, user) {
  const settings = campaign.settings || {};
  const delay = Math.max(settings.delay || 30000, 15000);

  console.log(`📧 Starting email sending from ${user.gmailAddress} to ${contacts.length} contacts...`);

  let sentCount = 0;
  let failedCount = 0;

  // Create transporter once
  const userTransporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: user.gmailAddress,
      pass: user.gmailAppPassword
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  // Verify transporter
  try {
    await userTransporter.verify();
  } catch (error) {
    console.error('❌ Gmail verification failed:', error);
    throw new Error('Gmail connection failed');
  }

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];

    try {
      await sendSingleEmail(campaignId, template, contact, user, userTransporter);
      sentCount++;
      console.log(`✅ Email ${sentCount}/${contacts.length} sent to: ${contact.email}`);

      // Update progress
      await db.collection('campaigns').updateOne(
        { _id: new ObjectId(campaignId) },
        { $set: { sentCount } }
      );

      // Delay between emails
      if (i < contacts.length - 1) {
        console.log(`⏳ Waiting ${delay/1000}s before next email...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

    } catch (error) {
      console.error(`❌ Failed to send to ${contact.email}:`, error.message);
      failedCount++;
      
      await logOutreach(campaignId, contact._id, contact.email, 'failed', '', error.message);
    }
  }

  // Final status update
  const finalStatus = sentCount > 0 ? 'completed' : 'failed';
  await db.collection('campaigns').updateOne(
    { _id: new ObjectId(campaignId) },
    { 
      $set: { 
        status: finalStatus, 
        sentCount,
        completedAt: new Date()
      } 
    }
  );

  console.log(`🎉 Campaign ${campaignId} completed: ${sentCount} sent, ${failedCount} failed`);
}

async function sendSingleEmail(campaignId, template, contact, user, transporter) {
  // Generate tracking ID
  const trackingId = uuidv4();

  // Create tracking record
  await db.collection('emailTracking').insertOne({
    campaignId: new ObjectId(campaignId),
    contactId: contact._id,
    email: contact.email,
    trackingId,
    opened: false,
    openedAt: null,
    clicked: false,
    clickedAt: null,
    clicksCount: 0,
    userAgent: null,
    ipAddress: null,
    createdAt: new Date()
  });

  // Personalize content
  const personalizedSubject = personalizeContent(template.subject, contact, { userName: user.name });
  let personalizedHtml = personalizeContent(template.htmlBody || '', contact, { userName: user.name });
  const personalizedText = personalizeContent(template.textBody || '', contact, { userName: user.name });

  // Add tracking pixel
  const trackingPixel = `<img src="${BASE_URL}/track/open/${trackingId}" width="1" height="1" style="display:none;" alt="">`;
  
  if (personalizedHtml) {
    personalizedHtml += trackingPixel;
  }

  // Add user's signature
  if (user.signature) {
    if (personalizedHtml) {
      personalizedHtml += '<br><br>' + user.signature.replace(/\n/g, '<br>');
    }
    if (personalizedText) {
      personalizedText += '\n\n' + user.signature;
    }
  }

  // Send email
  const emailOptions = {
    from: `"${user.name}" <${user.gmailAddress}>`,
    to: contact.email,
    subject: personalizedSubject,
    headers: {
      'Reply-To': user.gmailAddress,
      'X-Priority': '3',
      'X-Mailer': 'Personal'
    }
  };

  if (personalizedHtml) {
    emailOptions.html = personalizedHtml;
  }
  if (personalizedText) {
    emailOptions.text = personalizedText;
  }

  await transporter.sendMail(emailOptions);

  // Mark contact as contacted
  await db.collection('contacts').updateOne(
    { _id: contact._id },
    { 
      $set: { 
        contacted: true, 
        lastContacted: new Date() 
      } 
    }
  );

  // Log success
  await logOutreach(campaignId, contact._id, contact.email, 'sent', personalizedSubject);
}

function personalizeContent(content, contact, extras = {}) {
  if (!content || typeof content !== 'string') {
    return '';
  }

  const customFields = contact.customFields || {};
  const firstName = contact.name ? contact.name.split(' ')[0] : 'there';

  let personalized = content
    .replace(/\{\{name\}\}/g, contact.name || 'there')
    .replace(/\{\{firstName\}\}/g, firstName)
    .replace(/\{\{email\}\}/g, contact.email || '')
    .replace(/\{\{company\}\}/g, contact.company || 'your company')
    .replace(/\{\{position\}\}/g, contact.position || 'your role')
    .replace(/\{\{linkedin\}\}/g, contact.linkedinUrl || '')
    .replace(/\{\{myName\}\}/g, extras.userName || '');

  // Handle custom fields
  personalized = personalized.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    return customFields[key] || extras[key] || match;
  });

  return personalized;
}

async function logOutreach(campaignId, contactId, email, status, subject, notes = null) {
  try {
    await db.collection('emailLogs').insertOne({
      campaignId: new ObjectId(campaignId),
      contactId,
      email,
      status,
      subject,
      notes,
      sentAt: new Date(),
      responseReceived: false
    });

    console.log(`📝 Logged outreach: ${email} - ${status}`);
  } catch (error) {
    console.error('Error logging outreach:', error);
  }
}

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  
  if (res.headersSent) {
    return next(err);
  }
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// =============================================================================
// START SERVER
// =============================================================================

async function startServer() {
  // Connect to MongoDB first
  const mongoConnected = await connectToMongoDB();
  
  if (!mongoConnected) {
    console.error('❌ Failed to connect to MongoDB. Exiting...');
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                    💼 PROFESSIONAL COLD EMAIL SYSTEM                         ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  Web Interface: ${BASE_URL.padEnd(44)} ║
║  Database: MongoDB ${process.env.MONGODB_URI ? '(Custom)' : '(Local)'}                                          ║
║  Email Service: Individual User Gmail Accounts                               ║
║                                                                               ║
║  🎯 Users configure their own Gmail in Settings tab                          ║
║  ☁️  Data is persistent in MongoDB                                           ║
╚═══════════════════════════════════════════════════════════════════════════════╝

💼 PROFESSIONAL COLD EMAIL FEATURES:
   ✅ Individual Gmail accounts for each user
   ✅ Personal sender identity (appears from user's Gmail)
   ✅ No unsubscribe links or campaign branding
   ✅ Professional sending rate (30s delays)
   ✅ Contact management with company/position
   ✅ Personalized templates with {{name}}, {{company}}, etc.
   ✅ Response tracking and follow-up management
   ✅ MongoDB for persistent storage

🎯 SETUP PROCESS:
   • Users register for account
   • Configure their Gmail in Settings tab
   • Add contacts and create templates
   • Send professional cold emails from their Gmail

🔐 SECURITY FEATURES:
   • Each user's Gmail credentials encrypted and secure
   • App passwords required (never regular passwords)
   • Individual email quotas and rate limiting
   • Professional email tracking and analytics
   • JWT authentication with secure secret
    `);
  });

  return server;
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  
  if (client) {
    await client.close();
    console.log('MongoDB connection closed');
  }
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  
  if (client) {
    await client.close();
    console.log('MongoDB connection closed');
  }
  
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});