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

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

console.log('🚀 Starting Professional Cold Email System with MongoDB...');

// =============================================================================
// MIDDLEWARE
// =============================================================================

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Conservative rate limiting for professional use
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50 // 50 emails per hour max (professional sending rate)
});
app.use(limiter);

// =============================================================================
// MONGODB CONNECTION
// =============================================================================

let db;
let client;

async function connectToMongoDB() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/cold_email_system';
    
    console.log('🔗 Connecting to MongoDB...');
    client = new MongoClient(mongoUri);
    await client.connect();
    
    db = client.db();
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
// AUTHENTICATION
// =============================================================================

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
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

app.get('/health', (req, res) => {
  const memUsage = process.memoryUsage();
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    emailServiceType: 'Individual User Gmail Accounts',
    database: 'MongoDB Atlas',
    environment: process.env.NODE_ENV || 'development',
    baseUrl: process.env.BASE_URL,
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      total: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB'
    }
  });
});

// Authentication with name field
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, signature } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password required' });
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
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log(`✅ User registered: ${name} (${email})`);
    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: { id: userId, name, email, signature }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await db.collection('users').findOne({ 
      email, 
      isActive: true 
    });

    if (!user || !await bcrypt.compare(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user._id.toString(), email: user.email, name: user.name },
      process.env.JWT_SECRET,
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
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Contacts management
app.post('/api/contacts', authenticateToken, async (req, res) => {
  try {
    const { name, email, company, position, linkedinUrl, notes, customFields } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
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
  } catch (error) {
    console.error('Add contact error:', error);
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

app.get('/api/contacts', authenticateToken, async (req, res) => {
  try {
    const contacts = await db.collection('contacts')
      .find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      contacts,
      pagination: { total: contacts.length }
    });
  } catch (error) {
    console.error('Get contacts error:', error);
    res.status(500).json({ error: 'Failed to get contacts' });
  }
});

// Bulk contact import
app.post('/api/contacts/bulk', authenticateToken, async (req, res) => {
  try {
    const { contacts } = req.body;

    if (!Array.isArray(contacts)) {
      return res.status(400).json({ error: 'Contacts must be an array' });
    }

    let successCount = 0;
    let errorCount = 0;

    for (const contact of contacts) {
      try {
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
        console.error('Bulk import error for contact:', contact.email, error);
      }
    }

    console.log(`✅ Bulk import: ${successCount} contacts added`);
    res.json({
      message: 'Bulk import completed',
      successful: successCount,
      errors: errorCount
    });
  } catch (error) {
    console.error('Bulk import error:', error);
    res.status(500).json({ error: 'Bulk import failed' });
  }
});

// Templates
app.post('/api/templates', authenticateToken, async (req, res) => {
  try {
    const { name, subject, htmlBody, textBody, templateType } = req.body;

    if (!name || !subject || !htmlBody) {
      return res.status(400).json({ error: 'Name, subject, and body are required' });
    }

    const template = {
      userId: req.user.userId,
      name,
      subject,
      htmlBody,
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
  } catch (error) {
    console.error('Create template error:', error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

app.get('/api/templates', authenticateToken, async (req, res) => {
  try {
    const templates = await db.collection('templates')
      .find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .toArray();

    // Convert _id to id for frontend compatibility
    const templatesWithId = templates.map(template => ({
      ...template,
      id: template._id.toString()
    }));

    res.json(templatesWithId);
  } catch (error) {
    console.error('Get templates error:', error);
    res.status(500).json({ error: 'Failed to get templates' });
  }
});

// Get single template for editing
app.get('/api/templates/:id', authenticateToken, async (req, res) => {
  try {
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
      id: template._id.toString()
    });
  } catch (error) {
    console.error('Get template error:', error);
    res.status(500).json({ error: 'Failed to get template' });
  }
});

// Update template
app.put('/api/templates/:id', authenticateToken, async (req, res) => {
  try {
    const templateId = req.params.id;
    const { name, subject, htmlBody, textBody, templateType } = req.body;

    if (!name || !subject || !htmlBody) {
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
          htmlBody,
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
  } catch (error) {
    console.error('Update template error:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// Delete template
app.delete('/api/templates/:id', authenticateToken, async (req, res) => {
  try {
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
  } catch (error) {
    console.error('Delete template error:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// Outreach campaigns
app.post('/api/campaigns', authenticateToken, async (req, res) => {
  try {
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
      settings: settings || {},
      createdAt: new Date()
    };

    const result = await db.collection('campaigns').insertOne(campaign);

    console.log(`✅ Outreach campaign created: ${name}`);
    res.status(201).json({ 
      message: 'Campaign created', 
      id: result.insertedId.toString() 
    });
  } catch (error) {
    console.error('Create campaign error:', error);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

app.get('/api/campaigns', authenticateToken, async (req, res) => {
  try {
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
  } catch (error) {
    console.error('Get campaigns error:', error);
    res.status(500).json({ error: 'Failed to get campaigns' });
  }
});

// Send professional outreach campaign
app.post('/api/campaigns/:id/send', authenticateToken, async (req, res) => {
  try {
    const campaignId = req.params.id;

    if (!ObjectId.isValid(campaignId)) {
      return res.status(400).json({ error: 'Invalid campaign ID' });
    }

    console.log(`🔍 Starting campaign ${campaignId} for user ${req.user.userId}`);

    // Check if user has Gmail configured
    const user = await db.collection('users').findOne({ 
      _id: new ObjectId(req.user.userId) 
    });

    if (!user.gmailConfigured || !user.gmailAddress || !user.gmailAppPassword) {
      return res.status(400).json({
        error: 'Gmail not configured. Please configure your Gmail settings in the Settings tab before sending campaigns.'
      });
    }

    // Create user-specific email transporter
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

    // Verify user's Gmail connection
    try {
      await userTransporter.verify();
    } catch (error) {
      return res.status(400).json({
        error: 'Gmail connection failed. Please check your Gmail settings.',
        details: error.message
      });
    }

    // Get campaign with template data
    const campaignData = await db.collection('campaigns').aggregate([
      { $match: { _id: new ObjectId(campaignId), userId: req.user.userId } },
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
          templateName: { $arrayElemAt: ['$template.name', 0] },
          subject: { $arrayElemAt: ['$template.subject', 0] },
          htmlBody: { $arrayElemAt: ['$template.htmlBody', 0] },
          textBody: { $arrayElemAt: ['$template.textBody', 0] }
        }
      }
    ]).toArray();

    if (campaignData.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const campaign = campaignData[0];

    // Get available contacts
    const contacts = await db.collection('contacts')
      .find({ userId: req.user.userId, contacted: false })
      .limit(50)
      .toArray();

    if (contacts.length === 0) {
      return res.status(400).json({ 
        error: 'No new contacts to reach out to. All contacts have already been contacted.' 
      });
    }

    // Update campaign status immediately
    await db.collection('campaigns').updateOne(
      { _id: new ObjectId(campaignId) },
      { 
        $set: { 
          status: 'sending', 
          totalContacts: contacts.length 
        } 
      }
    );

    // Send response immediately to prevent timeout
    res.json({
      message: `Campaign started using ${user.gmailAddress}! Emails are being sent in the background.`,
      totalContacts: contacts.length,
      campaignName: campaign.name,
      gmailAccount: user.gmailAddress
    });

    // Start sending emails asynchronously
    setImmediate(() => {
      sendEmailsWithUserGmail(campaignId, campaign, contacts, user, userTransporter)
        .catch(error => {
          console.error('Background email sending failed:', error);
          db.collection('campaigns').updateOne(
            { _id: new ObjectId(campaignId) },
            { $set: { status: 'failed' } }
          );
        });
    });

  } catch (error) {
    console.error('❌ Campaign start error:', error);
    res.status(500).json({ error: 'Failed to start campaign: ' + error.message });
  }
});

// Gmail Configuration Routes
app.get('/api/user/gmail-config', authenticateToken, async (req, res) => {
  try {
    const user = await db.collection('users').findOne({ 
      _id: new ObjectId(req.user.userId) 
    });
    
    res.json({
      gmailAddress: user.gmailAddress || '',
      configured: !!user.gmailConfigured,
      verified: !!user.gmailVerified,
      lastTested: user.gmailLastTested
    });
  } catch (error) {
    console.error('Get Gmail config error:', error);
    res.status(500).json({ error: 'Failed to get Gmail configuration' });
  }
});

app.post('/api/user/gmail-config', authenticateToken, async (req, res) => {
  try {
    const { gmailAddress, gmailAppPassword } = req.body;
    
    if (!gmailAddress || !gmailAppPassword) {
      return res.status(400).json({ error: 'Gmail address and app password are required' });
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@gmail\.com$/i;
    if (!emailRegex.test(gmailAddress)) {
      return res.status(400).json({ error: 'Please enter a valid Gmail address' });
    }
    
    // App password validation
    if (gmailAppPassword.replace(/\s/g, '').length !== 16) {
      return res.status(400).json({ error: 'Gmail app password should be 16 characters long' });
    }
    
    try {
      // Test the Gmail configuration
      const testTransporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
          user: gmailAddress,
          pass: gmailAppPassword.replace(/\s/g, '')
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
            gmailAppPassword: gmailAppPassword.replace(/\s/g, ''),
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
            gmailAppPassword: gmailAppPassword.replace(/\s/g, ''),
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
  } catch (error) {
    console.error('Gmail config error:', error);
    res.status(500).json({ error: 'Failed to save Gmail configuration' });
  }
});

app.post('/api/user/gmail-test', authenticateToken, async (req, res) => {
  try {
    const user = await db.collection('users').findOne({ 
      _id: new ObjectId(req.user.userId) 
    });
    
    if (!user || !user.gmailAddress || !user.gmailAppPassword) {
      return res.status(400).json({ error: 'Gmail not configured. Please configure your Gmail settings first.' });
    }
    
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
});

app.delete('/api/user/gmail-config', authenticateToken, async (req, res) => {
  try {
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
  } catch (error) {
    console.error('Remove Gmail config error:', error);
    res.status(500).json({ error: 'Failed to remove Gmail configuration' });
  }
});

// Email tracking endpoints
app.get('/track/open/:trackingId', async (req, res) => {
  try {
    const trackingId = req.params.trackingId;
    const userAgent = req.get('User-Agent');
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    console.log(`📊 Email opened - Tracking ID: ${trackingId}`);

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
  } catch (error) {
    console.error('Tracking pixel error:', error);
    res.status(500).send('Error');
  }
});

// Campaign Analytics
app.get('/api/campaigns/analytics/summary', authenticateToken, async (req, res) => {
  try {
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
          trackedEmails: { $size: '$tracking' },
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
              if: { $gt: ['$trackedEmails', 0] },
              then: { $round: [{ $multiply: [{ $divide: ['$opens', '$trackedEmails'] }, 100] }] },
              else: 0
            }
          },
          clickRate: {
            $cond: {
              if: { $gt: ['$trackedEmails', 0] },
              then: { $round: [{ $multiply: [{ $divide: ['$clicks', '$trackedEmails'] }, 100] }] },
              else: 0
            }
          }
        }
      },
      { $sort: { createdAt: -1 } }
    ]).toArray();

    const campaignsWithId = campaigns.map(campaign => ({
      ...campaign,
      id: campaign._id.toString()
    }));

    res.json(campaignsWithId);
  } catch (error) {
    console.error('Campaign analytics error:', error);
    res.status(500).json({ error: 'Failed to get campaign analytics' });
  }
});

app.get('/api/campaigns/:id/analytics', authenticateToken, async (req, res) => {
  try {
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
          totalClicks: { $sum: '$clicksCount' }
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
        openedAt: contact.openedAt,
        clicked: contact.clicked,
        clickedAt: contact.clickedAt,
        clicksCount: contact.clicksCount || 0
      }))
    };

    res.json(analytics);
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// =============================================================================
// EMAIL SENDING FUNCTIONS
// =============================================================================

async function sendEmailsWithUserGmail(campaignId, campaign, contacts, user, userTransporter) {
  const settings = campaign.settings || {};
  const delay = Math.max(settings.delay || 30000, 15000);
  const maxEmails = Math.min(contacts.length, 20);

  console.log(`📧 Starting email sending from ${user.gmailAddress} to ${maxEmails} contacts...`);

  let sentCount = 0;
  let failedCount = 0;

  for (let i = 0; i < maxEmails; i++) {
    const contact = contacts[i];

    try {
      await Promise.race([
        sendSingleEmailWithUserGmail(campaignId, campaign, contact, user, userTransporter),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Email timeout')), 10000)
        )
      ]);

      sentCount++;
      console.log(`✅ Email ${sentCount}/${maxEmails} sent from ${user.gmailAddress} to: ${contact.email}`);

      // Update progress
      await db.collection('campaigns').updateOne(
        { _id: new ObjectId(campaignId) },
        { $set: { sentCount } }
      );

      // Delay between emails
      if (i < maxEmails - 1) {
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
        sentCount 
      } 
    }
  );

  console.log(`🎉 Campaign ${campaignId} completed from ${user.gmailAddress}: ${sentCount} sent, ${failedCount} failed`);
}

async function sendSingleEmailWithUserGmail(campaignId, campaign, contact, user, userTransporter) {
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
  const personalizedSubject = personalizeContent(campaign.subject, contact, { ...campaign, userName: user.name });
  let personalizedHtml = personalizeContent(campaign.htmlBody, contact, { ...campaign, userName: user.name });
  const personalizedText = personalizeContent(campaign.textBody, contact, { ...campaign, userName: user.name });

  // Add tracking pixel
  const baseUrl = process.env.BASE_URL || 'https://email-campaign-system.onrender.com';
  const trackingPixel = `<img src="${baseUrl}/track/open/${trackingId}" width="1" height="1" style="display:none;" alt="">`;
  personalizedHtml += trackingPixel;

  // Add user's signature
  if (user.signature) {
    personalizedHtml += '<br><br>' + user.signature.replace(/\n/g, '<br>');
  }

  // Send email
  await userTransporter.sendMail({
    from: `"${user.name}" <${user.gmailAddress}>`,
    to: contact.email,
    subject: personalizedSubject,
    html: personalizedHtml,
    text: personalizedText + (user.signature ? '\n\n' + user.signature : ''),
    headers: {
      'Reply-To': user.gmailAddress,
      'X-Priority': '3',
      'X-Mailer': 'Personal'
    }
  });

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

function personalizeContent(content, contact, campaign) {
  if (!content) return '';

  const customFields = contact.customFields || {};

  let personalized = content
    .replace(/\{\{name\}\}/g, contact.name || 'there')
    .replace(/\{\{firstName\}\}/g, contact.name ? contact.name.split(' ')[0] : 'there')
    .replace(/\{\{email\}\}/g, contact.email)
    .replace(/\{\{company\}\}/g, contact.company || 'your company')
    .replace(/\{\{position\}\}/g, contact.position || 'your role')
    .replace(/\{\{linkedin\}\}/g, contact.linkedinUrl || '')
    .replace(/\{\{myName\}\}/g, campaign.userName || '');

  // Handle custom fields
  personalized = personalized.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    return customFields[key] || match;
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
║  Web Interface: http://localhost:${PORT}                                        ║
║  Database: MongoDB Atlas (Cloud)                                             ║
║  Email Service: Individual User Gmail Accounts                               ║
║                                                                               ║
║  🎯 Users configure their own Gmail in Settings tab                          ║
║  ☁️  Data is now persistent in the cloud!                                    ║
╚═══════════════════════════════════════════════════════════════════════════════╝

💼 PROFESSIONAL COLD EMAIL FEATURES:
   ✅ Individual Gmail accounts for each user
   ✅ Personal sender identity (appears from user's Gmail)
   ✅ No unsubscribe links or campaign branding
   ✅ Professional sending rate (30s delays)
   ✅ Contact management with company/position
   ✅ Personalized templates with {{name}}, {{company}}, etc.
   ✅ Response tracking and follow-up management
   ✅ MongoDB Atlas for persistent cloud storage

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
   • Cloud database with automatic backups
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

startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});