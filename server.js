// =============================================================================
// PROFESSIONAL COLD EMAIL SYSTEM FOR JOB APPLICATIONS
// Clean, personal emails without campaign branding
// =============================================================================

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sqlite3 = require('sqlite3').verbose();
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

console.log('🚀 Starting Professional Cold Email System...');

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
// DATABASE SETUP
// =============================================================================

['./data', './logs'].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const db = new sqlite3.Database('./data/cold_email_system.db', (err) => {
  if (err) {
    console.error('❌ Database connection failed:', err);
    process.exit(1);
  }
  console.log('✅ Connected to SQLite database');
});

// Initialize database tables (removed unsubscribe tables)
db.serialize(() => {
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      signature TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_active BOOLEAN DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT,
      email TEXT NOT NULL,
      company TEXT,
      position TEXT,
      linkedin_url TEXT,
      notes TEXT,
      custom_fields JSON,
      contacted BOOLEAN DEFAULT 0,
      last_contacted DATETIME,
      response_received BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id),
      UNIQUE(user_id, email)
    )`,
    `CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      html_body TEXT,
      text_body TEXT,
      template_type TEXT DEFAULT 'outreach', -- 'outreach', 'follow_up', 'thank_you'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`,
    `CREATE TABLE IF NOT EXISTS outreach_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT NOT NULL,
      template_id INTEGER,
      status TEXT DEFAULT 'draft',
      total_contacts INTEGER DEFAULT 0,
      sent_count INTEGER DEFAULT 0,
      replied_count INTEGER DEFAULT 0,
      settings JSON,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id),
      FOREIGN KEY (template_id) REFERENCES templates (id)
    )`,
    `CREATE TABLE IF NOT EXISTS email_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER,
      contact_id INTEGER,
      email TEXT NOT NULL,
      status TEXT NOT NULL,
      subject TEXT,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      response_received BOOLEAN DEFAULT 0,
      notes TEXT,
      FOREIGN KEY (campaign_id) REFERENCES outreach_campaigns (id),
      FOREIGN KEY (contact_id) REFERENCES contacts (id)
    )`,
    `CREATE TABLE IF NOT EXISTS email_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER,
    contact_id INTEGER,
    email TEXT NOT NULL,
    tracking_id TEXT UNIQUE NOT NULL,
    opened BOOLEAN DEFAULT 0,
    opened_at DATETIME,
    clicked BOOLEAN DEFAULT 0,
    clicked_at DATETIME,
    clicks_count INTEGER DEFAULT 0,
    user_agent TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES outreach_campaigns (id),
    FOREIGN KEY (contact_id) REFERENCES contacts (id)
  )`,
    `CREATE TABLE IF NOT EXISTS tracked_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_id TEXT NOT NULL,
    original_url TEXT NOT NULL,
    clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_agent TEXT,
    ip_address TEXT,
    FOREIGN KEY (tracking_id) REFERENCES email_tracking (tracking_id)
  )`
  ];

  tables.forEach((sql, index) => {
    db.run(sql, (err) => {
      if (err) {
        console.error(`❌ Error creating table ${index + 1}:`, err);
      }
    });
  });

  console.log('✅ Database tables initialized');
  db.all("PRAGMA table_info(users)", (err, columns) => {
    if (err) {
      console.error('Error checking table info:', err);
      return;
    }
    
    const columnNames = columns.map(col => col.name);
    
    // Add new columns if they don't exist
    const newColumns = [
      { name: 'gmail_address', sql: 'ALTER TABLE users ADD COLUMN gmail_address TEXT' },
      { name: 'gmail_app_password', sql: 'ALTER TABLE users ADD COLUMN gmail_app_password TEXT' },
      { name: 'gmail_configured', sql: 'ALTER TABLE users ADD COLUMN gmail_configured BOOLEAN DEFAULT 0' },
      { name: 'gmail_verified', sql: 'ALTER TABLE users ADD COLUMN gmail_verified BOOLEAN DEFAULT 0' },
      { name: 'gmail_last_tested', sql: 'ALTER TABLE users ADD COLUMN gmail_last_tested DATETIME' }
    ];
    
    newColumns.forEach(column => {
      if (!columnNames.includes(column.name)) {
        db.run(column.sql, (err) => {
          if (err) {
            console.error(`Error adding column ${column.name}:`, err);
          } else {
            console.log(`✅ Added column: ${column.name}`);
          }
        });
      }
    });
  });
  
  console.log('✅ Database schema updated for individual Gmail settings');
});

// =============================================================================
// EMAIL SERVICE SETUP
// =============================================================================

// let emailTransporter = null;

// async function initializeEmailService() {
//   try {
//     if (!process.env.SMTP_USERNAME || process.env.SMTP_USERNAME === 'YOUR_GMAIL_ADDRESS_HERE') {
//       console.log('⚠️  Gmail not configured in .env file');
//       return false;
//     }

//     console.log('🔧 Configuring professional email service...');
//     console.log(`📧 Your email: ${process.env.SMTP_USERNAME}`);

//     emailTransporter = nodemailer.createTransport({
//       host: process.env.SMTP_HOST,
//       port: parseInt(process.env.SMTP_PORT),
//       secure: process.env.SMTP_SECURE === 'true',
//       auth: {
//         user: process.env.SMTP_USERNAME,
//         pass: process.env.SMTP_PASSWORD
//       },
//       tls: {
//         rejectUnauthorized: false
//       }
//     });

//     await emailTransporter.verify();
//     console.log('✅ Professional email service ready!');
//     return true;
//   } catch (error) {
//     console.log('❌ Email service connection failed:', error.message);
//     return false;
//   }
// }

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

    const hashedPassword = await bcrypt.hash(password, 10);

    db.run(
      'INSERT INTO users (name, email, password_hash, signature) VALUES (?, ?, ?, ?)',
      [name, email, hashedPassword, signature || ''],
      function (err) {
        if (err) {
          if (err.code === 'SQLITE_CONSTRAINT') {
            return res.status(409).json({ error: 'User already exists' });
          }
          return res.status(500).json({ error: 'Registration failed' });
        }

        const token = jwt.sign(
          { userId: this.lastID, email, name },
          process.env.JWT_SECRET,
          { expiresIn: '24h' }
        );

        console.log(`✅ User registered: ${name} (${email})`);
        res.status(201).json({
          message: 'Account created successfully',
          token,
          user: { id: this.lastID, name, email, signature }
        });
      }
    );
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    db.get(
      'SELECT * FROM users WHERE email = ? AND is_active = 1',
      [email],
      async (err, user) => {
        if (err) {
          return res.status(500).json({ error: 'Login failed' });
        }

        if (!user || !await bcrypt.compare(password, user.password_hash)) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
          { userId: user.id, email: user.email, name: user.name },
          process.env.JWT_SECRET,
          { expiresIn: '24h' }
        );

        console.log(`✅ User logged in: ${user.name} (${user.email})`);
        res.json({
          message: 'Login successful',
          token,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            signature: user.signature
          }
        });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Contacts management
app.post('/api/contacts', authenticateToken, (req, res) => {
  const { name, email, company, position, linkedinUrl, notes, customFields } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  db.run(
    'INSERT OR REPLACE INTO contacts (user_id, name, email, company, position, linkedin_url, notes, custom_fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [req.user.userId, name || '', email, company || '', position || '', linkedinUrl || '', notes || '', JSON.stringify(customFields || {})],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to add contact' });
      }
      console.log(`✅ Contact added: ${name} (${email}) at ${company}`);
      res.status(201).json({ message: 'Contact added', id: this.lastID });
    }
  );
});

app.get('/api/contacts', authenticateToken, (req, res) => {
  db.all(
    'SELECT * FROM contacts WHERE user_id = ? ORDER BY created_at DESC',
    [req.user.userId],
    (err, contacts) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to get contacts' });
      }
      res.json({
        contacts: contacts.map(c => ({
          ...c,
          custom_fields: JSON.parse(c.custom_fields || '{}')
        })),
        pagination: { total: contacts.length }
      });
    }
  );
});

// Templates
app.post('/api/templates', authenticateToken, (req, res) => {
  const { name, subject, htmlBody, textBody, templateType } = req.body;

  if (!name || !subject || !htmlBody) {
    return res.status(400).json({ error: 'Name, subject, and body are required' });
  }

  db.run(
    'INSERT INTO templates (user_id, name, subject, html_body, text_body, template_type) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user.userId, name, subject, htmlBody, textBody || '', templateType || 'outreach'],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create template' });
      }
      console.log(`✅ Template created: ${name}`);
      res.status(201).json({ message: 'Template created', id: this.lastID });
    }
  );
});

app.get('/api/templates', authenticateToken, (req, res) => {
  db.all(
    'SELECT * FROM templates WHERE user_id = ? ORDER BY created_at DESC',
    [req.user.userId],
    (err, templates) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to get templates' });
      }
      res.json(templates);
    }
  );
});

// Get single template for editing
app.get('/api/templates/:id', authenticateToken, (req, res) => {
  const templateId = req.params.id;

  db.get(
    'SELECT * FROM templates WHERE id = ? AND user_id = ?',
    [templateId, req.user.userId],
    (err, template) => {
      if (err) {
        console.error('Get template error:', err);
        return res.status(500).json({ error: 'Failed to get template' });
      }

      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }

      res.json(template);
    }
  );
});

// Update template
app.put('/api/templates/:id', authenticateToken, (req, res) => {
  const templateId = req.params.id;
  const { name, subject, htmlBody, textBody, templateType } = req.body;

  if (!name || !subject || !htmlBody) {
    return res.status(400).json({ error: 'Name, subject, and body are required' });
  }

  db.run(
    'UPDATE templates SET name = ?, subject = ?, html_body = ?, text_body = ?, template_type = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
    [name, subject, htmlBody, textBody || '', templateType || 'outreach', templateId, req.user.userId],
    function (err) {
      if (err) {
        console.error('Update template error:', err);
        return res.status(500).json({ error: 'Failed to update template' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Template not found' });
      }

      console.log(`✅ Template updated: ${name} (ID: ${templateId})`);
      res.json({ message: 'Template updated successfully', id: templateId });
    }
  );
});

// Delete template
app.delete('/api/templates/:id', authenticateToken, (req, res) => {
  const templateId = req.params.id;

  db.run(
    'DELETE FROM templates WHERE id = ? AND user_id = ?',
    [templateId, req.user.userId],
    function (err) {
      if (err) {
        console.error('Delete template error:', err);
        return res.status(500).json({ error: 'Failed to delete template' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Template not found' });
      }

      console.log(`✅ Template deleted: ID ${templateId}`);
      res.json({ message: 'Template deleted successfully' });
    }
  );
});

// Outreach campaigns
app.post('/api/campaigns', authenticateToken, (req, res) => {
  const { name, templateId, settings } = req.body;

  if (!name || !templateId) {
    return res.status(400).json({ error: 'Name and template are required' });
  }

  db.run(
    'INSERT INTO outreach_campaigns (user_id, name, template_id, settings) VALUES (?, ?, ?, ?)',
    [req.user.userId, name, templateId, JSON.stringify(settings || {})],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create campaign' });
      }
      console.log(`✅ Outreach campaign created: ${name}`);
      res.status(201).json({ message: 'Campaign created', id: this.lastID });
    }
  );
});

app.get('/api/campaigns', authenticateToken, (req, res) => {
  db.all(
    `SELECT c.*, t.name as template_name 
     FROM outreach_campaigns c 
     LEFT JOIN templates t ON c.template_id = t.id 
     WHERE c.user_id = ? 
     ORDER BY c.created_at DESC`,
    [req.user.userId],
    (err, campaigns) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to get campaigns' });
      }
      res.json(campaigns.map(c => ({
        ...c,
        settings: JSON.parse(c.settings || '{}')
      })));
    }
  );
});

// Send professional outreach campaign
app.post('/api/campaigns/:id/send', authenticateToken, async (req, res) => {
  const campaignId = req.params.id;

  console.log(`🔍 Starting campaign ${campaignId} for user ${req.user.userId}`);

  try {
    // First check if user has Gmail configured
    const user = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM users WHERE id = ?',
        [req.user.userId],
        (err, user) => err ? reject(err) : resolve(user)
      );
    });

    if (!user.gmail_configured || !user.gmail_address || !user.gmail_app_password) {
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
        user: user.gmail_address,
        pass: user.gmail_app_password
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
    const campaignData = await new Promise((resolve, reject) => {
      db.get(`
        SELECT 
          c.*,
          t.name as template_name,
          t.subject,
          t.html_body,
          t.text_body
        FROM outreach_campaigns c
        JOIN templates t ON c.template_id = t.id
        WHERE c.id = ? AND c.user_id = ?
      `, [campaignId, req.user.userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!campaignData) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Get available contacts
    const contacts = await new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM contacts WHERE user_id = ? AND contacted = 0 LIMIT 50',
        [req.user.userId],
        (err, rows) => err ? reject(err) : resolve(rows)
      );
    });

    if (contacts.length === 0) {
      return res.status(400).json({ 
        error: 'No new contacts to reach out to. All contacts have already been contacted.' 
      });
    }

    // Update campaign status immediately
    db.run(
      'UPDATE outreach_campaigns SET status = ?, total_contacts = ? WHERE id = ?',
      ['sending', contacts.length, campaignId]
    );

    // Send response immediately to prevent timeout
    res.json({
      message: `Campaign started using ${user.gmail_address}! Emails are being sent in the background.`,
      totalContacts: contacts.length,
      campaignName: campaignData.name,
      gmailAccount: user.gmail_address
    });

    // Start sending emails asynchronously with user's transporter
    setImmediate(() => {
      sendEmailsWithUserGmail(campaignId, campaignData, contacts, user, userTransporter)
        .catch(error => {
          console.error('Background email sending failed:', error);
          db.run(
            'UPDATE outreach_campaigns SET status = ? WHERE id = ?',
            ['failed', campaignId]
          );
        });
    });

  } catch (error) {
    console.error('❌ Campaign start error:', error);
    res.status(500).json({ error: 'Failed to start campaign: ' + error.message });
  }
});

// Email tracking
// Tracking pixel endpoint (tracks email opens)
app.get('/track/open/:trackingId', (req, res) => {
  const trackingId = req.params.trackingId;
  const userAgent = req.get('User-Agent');
  const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

  console.log(`📊 Email opened - Tracking ID: ${trackingId}`);

  // Update tracking record
  db.run(
    'UPDATE email_tracking SET opened = 1, opened_at = CURRENT_TIMESTAMP, user_agent = ?, ip_address = ? WHERE tracking_id = ? AND opened = 0',
    [userAgent, ipAddress, trackingId],
    function (err) {
      if (err) {
        console.error('Tracking update error:', err);
      } else if (this.changes > 0) {
        console.log(`✅ Email open tracked: ${trackingId}`);
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
});

// Link click tracking endpoint
app.get('/track/click/:trackingId/:linkIndex', (req, res) => {
  const { trackingId, linkIndex } = req.params;
  const userAgent = req.get('User-Agent');
  const ipAddress = req.ip || req.connection.remoteAddress;

  console.log(`🔗 Link clicked - Tracking ID: ${trackingId}, Link: ${linkIndex}`);

  // Get the original URL
  db.get(
    'SELECT original_url FROM tracked_links WHERE tracking_id = ? AND id = ?',
    [trackingId, linkIndex],
    (err, link) => {
      if (err || !link) {
        console.error('Link tracking error:', err);
        return res.status(404).send('Link not found');
      }

      // Log the click
      db.run(
        'INSERT INTO tracked_links (tracking_id, original_url, user_agent, ip_address) VALUES (?, ?, ?, ?)',
        [trackingId, link.original_url, userAgent, ipAddress]
      );

      // Update tracking record
      db.run(
        'UPDATE email_tracking SET clicked = 1, clicked_at = CURRENT_TIMESTAMP, clicks_count = clicks_count + 1 WHERE tracking_id = ?',
        [trackingId],
        function (err) {
          if (err) {
            console.error('Click tracking update error:', err);
          } else {
            console.log(`✅ Link click tracked: ${trackingId}`);

            // Update campaign stats
            db.run(`
              UPDATE outreach_campaigns 
              SET clicked_count = (
                SELECT COUNT(DISTINCT tracking_id) FROM email_tracking 
                WHERE campaign_id = (
                  SELECT campaign_id FROM email_tracking WHERE tracking_id = ?
                ) AND clicked = 1
              )
              WHERE id = (
                SELECT campaign_id FROM email_tracking WHERE tracking_id = ?
              )
            `, [trackingId, trackingId]);
          }
        }
      );

      // Redirect to original URL
      res.redirect(link.original_url);
    }
  );
});

// Campaign Analytics
// Get detailed campaign analytics including tracking data
app.get('/api/campaigns/:id/analytics', authenticateToken, (req, res) => {
  const campaignId = req.params.id;

  // Verify campaign ownership
  db.get(
    'SELECT * FROM outreach_campaigns WHERE id = ? AND user_id = ?',
    [campaignId, req.user.userId],
    (err, campaign) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!campaign) {
        return res.status(404).json({ error: 'Campaign not found' });
      }

      // Get detailed tracking analytics
      const queries = [
        // Basic email logs
        new Promise((resolve, reject) => {
          db.all(
            'SELECT status, COUNT(*) as count FROM email_logs WHERE campaign_id = ? GROUP BY status',
            [campaignId],
            (err, rows) => err ? reject(err) : resolve(rows)
          );
        }),

        // Tracking data
        new Promise((resolve, reject) => {
          db.all(
            `SELECT 
               COUNT(*) as total_tracked,
               COUNT(CASE WHEN opened = 1 THEN 1 END) as opened,
               COUNT(CASE WHEN clicked = 1 THEN 1 END) as clicked,
               SUM(clicks_count) as total_clicks
             FROM email_tracking 
             WHERE campaign_id = ?`,
            [campaignId],
            (err, rows) => err ? reject(err) : resolve(rows[0] || {})
          );
        }),

        // Individual contact tracking
        new Promise((resolve, reject) => {
          db.all(
            `SELECT 
               c.name, c.email, c.company, c.position,
               et.opened, et.opened_at, et.clicked, et.clicked_at, et.clicks_count
             FROM email_tracking et
             JOIN contacts c ON et.contact_id = c.id
             WHERE et.campaign_id = ?
             ORDER BY et.created_at DESC`,
            [campaignId],
            (err, rows) => err ? reject(err) : resolve(rows)
          );
        })
      ];

      Promise.all(queries)
        .then(([emailLogs, trackingStats, contactTracking]) => {
          const emailStats = emailLogs.reduce((acc, stat) => {
            acc[stat.status] = stat.count;
            return acc;
          }, {});

          const analytics = {
            campaign: {
              id: campaign.id,
              name: campaign.name,
              status: campaign.status,
              total_contacts: campaign.total_contacts,
              sent_count: campaign.sent_count,
              created_at: campaign.created_at
            },
            emailStats: {
              sent: emailStats.sent || 0,
              failed: emailStats.failed || 0
            },
            trackingStats: {
              totalTracked: trackingStats.total_tracked || 0,
              opened: trackingStats.opened || 0,
              clicked: trackingStats.clicked || 0,
              totalClicks: trackingStats.total_clicks || 0,
              openRate: trackingStats.total_tracked > 0 ?
                Math.round((trackingStats.opened / trackingStats.total_tracked) * 100) : 0,
              clickRate: trackingStats.total_tracked > 0 ?
                Math.round((trackingStats.clicked / trackingStats.total_tracked) * 100) : 0
            },
            contactTracking: contactTracking.map(contact => ({
              ...contact,
              opened_at: contact.opened_at ? new Date(contact.opened_at).toISOString() : null,
              clicked_at: contact.clicked_at ? new Date(contact.clicked_at).toISOString() : null
            }))
          };

          res.json(analytics);
        })
        .catch(error => {
          console.error('Analytics error:', error);
          res.status(500).json({ error: 'Failed to fetch analytics' });
        });
    }
  );
});

// Get all campaigns with summary analytics
app.get('/api/campaigns/analytics/summary', authenticateToken, (req, res) => {
  db.all(
    `SELECT 
       c.id, c.name, c.status, c.total_contacts, c.sent_count, c.created_at,
       COUNT(et.id) as tracked_emails,
       COUNT(CASE WHEN et.opened = 1 THEN 1 END) as opens,
       COUNT(CASE WHEN et.clicked = 1 THEN 1 END) as clicks
     FROM outreach_campaigns c
     LEFT JOIN email_tracking et ON c.id = et.campaign_id
     WHERE c.user_id = ?
     GROUP BY c.id
     ORDER BY c.created_at DESC`,
    [req.user.userId],
    (err, campaigns) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to get campaign analytics' });
      }

      const analyticsData = campaigns.map(campaign => ({
        ...campaign,
        openRate: campaign.tracked_emails > 0 ?
          Math.round((campaign.opens / campaign.tracked_emails) * 100) : 0,
        clickRate: campaign.tracked_emails > 0 ?
          Math.round((campaign.clicks / campaign.tracked_emails) * 100) : 0
      }));

      res.json(analyticsData);
    }
  );
});

// Get user's Gmail configuration status
app.get('/api/user/gmail-config', authenticateToken, (req, res) => {
  db.get(
    'SELECT gmail_address, gmail_configured, gmail_verified, gmail_last_tested FROM users WHERE id = ?',
    [req.user.userId],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to get Gmail configuration' });
      }
      
      res.json({
        gmailAddress: user.gmail_address || '',
        configured: !!user.gmail_configured,
        verified: !!user.gmail_verified,
        lastTested: user.gmail_last_tested
      });
    }
  );
});

// Save user's Gmail configuration
app.post('/api/user/gmail-config', authenticateToken, async (req, res) => {
  const { gmailAddress, gmailAppPassword } = req.body;
  
  if (!gmailAddress || !gmailAppPassword) {
    return res.status(400).json({ error: 'Gmail address and app password are required' });
  }
  
  // Basic email validation
  const emailRegex = /^[^\s@]+@gmail\.com$/i;
  if (!emailRegex.test(gmailAddress)) {
    return res.status(400).json({ error: 'Please enter a valid Gmail address' });
  }
  
  // App password validation (should be 16 characters)
  if (gmailAppPassword.replace(/\s/g, '').length !== 16) {
    return res.status(400).json({ error: 'Gmail app password should be 16 characters long' });
  }
  
  try {
    // Test the Gmail configuration before saving
    const testTransporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: gmailAddress,
        pass: gmailAppPassword.replace(/\s/g, '') // Remove any spaces
      },
      tls: {
        rejectUnauthorized: false
      }
    });
    
    // Verify the connection
    await testTransporter.verify();
    
    // If verification successful, save the configuration
    db.run(
      `UPDATE users SET 
       gmail_address = ?, 
       gmail_app_password = ?, 
       gmail_configured = 1, 
       gmail_verified = 1, 
       gmail_last_tested = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [gmailAddress, gmailAppPassword.replace(/\s/g, ''), req.user.userId],
      function(err) {
        if (err) {
          console.error('Error saving Gmail config:', err);
          return res.status(500).json({ error: 'Failed to save Gmail configuration' });
        }
        
        console.log(`✅ Gmail configured for user ${req.user.userId}: ${gmailAddress}`);
        res.json({ 
          message: 'Gmail configuration saved and verified successfully!',
          verified: true 
        });
      }
    );
    
  } catch (error) {
    console.error('Gmail verification failed:', error);
    
    // Save as configured but not verified
    db.run(
      `UPDATE users SET 
       gmail_address = ?, 
       gmail_app_password = ?, 
       gmail_configured = 1, 
       gmail_verified = 0, 
       gmail_last_tested = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [gmailAddress, gmailAppPassword.replace(/\s/g, ''), req.user.userId],
      function(err) {
        if (err) {
          console.error('Error saving Gmail config:', err);
          return res.status(500).json({ error: 'Failed to save Gmail configuration' });
        }
        
        res.status(400).json({ 
          error: 'Gmail verification failed. Please check your credentials.',
          details: error.message,
          saved: true
        });
      }
    );
  }
});

// Test user's Gmail configuration
app.post('/api/user/gmail-test', authenticateToken, async (req, res) => {
  try {
    // Get user's Gmail configuration
    const user = await new Promise((resolve, reject) => {
      db.get(
        'SELECT gmail_address, gmail_app_password FROM users WHERE id = ?',
        [req.user.userId],
        (err, user) => err ? reject(err) : resolve(user)
      );
    });
    
    if (!user || !user.gmail_address || !user.gmail_app_password) {
      return res.status(400).json({ error: 'Gmail not configured. Please configure your Gmail settings first.' });
    }
    
    // Create transporter with user's credentials
    const userTransporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: user.gmail_address,
        pass: user.gmail_app_password
      },
      tls: {
        rejectUnauthorized: false
      }
    });
    
    // Verify connection
    await userTransporter.verify();
    
    // Send test email
    const testEmail = {
      from: `"${req.user.name}" <${user.gmail_address}>`,
      to: user.gmail_address, // Send to self
      subject: `Gmail Test - ${new Date().toLocaleString()}`,
      html: `
        <h2>🎉 Gmail Configuration Test Successful!</h2>
        <p>Hi ${req.user.name},</p>
        <p>Your Gmail configuration is working perfectly! Your cold email system is ready to use.</p>
        <p><strong>Gmail Account:</strong> ${user.gmail_address}</p>
        <p><strong>Test Time:</strong> ${new Date().toLocaleString()}</p>
        <p>You can now start sending professional cold emails using your own Gmail account.</p>
        <hr>
        <p><small>This test email was sent from your Professional Cold Email System</small></p>
      `,
      text: `Gmail Configuration Test Successful!\n\nHi ${req.user.name},\n\nYour Gmail configuration is working perfectly! Your cold email system is ready to use.\n\nGmail Account: ${user.gmail_address}\nTest Time: ${new Date().toLocaleString()}\n\nYou can now start sending professional cold emails using your own Gmail account.`
    };
    
    const result = await userTransporter.sendMail(testEmail);
    
    // Update verification status
    db.run(
      'UPDATE users SET gmail_verified = 1, gmail_last_tested = CURRENT_TIMESTAMP WHERE id = ?',
      [req.user.userId]
    );
    
    console.log(`✅ Gmail test successful for user ${req.user.userId}: ${user.gmail_address}`);
    
    res.json({
      success: true,
      message: 'Gmail test successful! Check your inbox for the test email.',
      messageId: result.messageId,
      sentTo: user.gmail_address
    });
    
  } catch (error) {
    console.error('Gmail test failed:', error);
    
    // Update verification status to failed
    db.run(
      'UPDATE users SET gmail_verified = 0, gmail_last_tested = CURRENT_TIMESTAMP WHERE id = ?',
      [req.user.userId]
    );
    
    res.status(400).json({
      success: false,
      error: 'Gmail test failed',
      details: error.message
    });
  }
});

// Remove user's Gmail configuration
app.delete('/api/user/gmail-config', authenticateToken, (req, res) => {
  db.run(
    `UPDATE users SET 
     gmail_address = NULL, 
     gmail_app_password = NULL, 
     gmail_configured = 0, 
     gmail_verified = 0, 
     gmail_last_tested = NULL 
     WHERE id = ?`,
    [req.user.userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to remove Gmail configuration' });
      }
      
      console.log(`✅ Gmail configuration removed for user ${req.user.userId}`);
      res.json({ message: 'Gmail configuration removed successfully' });
    }
  );
});

// =============================================================================
// PROFESSIONAL EMAIL SENDING FUNCTION
// =============================================================================

// Updated email sending function with user's Gmail
async function sendEmailsWithUserGmail(campaignId, campaign, contacts, user, userTransporter) {
  const settings = JSON.parse(campaign.settings || '{}');
  const delay = Math.max(settings.delay || 30000, 15000);
  const maxEmails = Math.min(contacts.length, 20);

  console.log(`📧 Starting email sending from ${user.gmail_address} to ${maxEmails} contacts...`);

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
      console.log(`✅ Email ${sentCount}/${maxEmails} sent from ${user.gmail_address} to: ${contact.email}`);

      // Update progress
      db.run(
        'UPDATE outreach_campaigns SET sent_count = ? WHERE id = ?',
        [sentCount, campaignId]
      );

      // Delay between emails
      if (i < maxEmails - 1) {
        console.log(`⏳ Waiting ${delay/1000}s before next email...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

    } catch (error) {
      console.error(`❌ Failed to send to ${contact.email}:`, error.message);
      failedCount++;
      
      await logOutreach(campaignId, contact.id, contact.email, 'failed', '', error.message);
    }
  }

  // Final status update
  const finalStatus = sentCount > 0 ? 'completed' : 'failed';
  db.run(
    'UPDATE outreach_campaigns SET status = ?, sent_count = ? WHERE id = ?',
    [finalStatus, sentCount, campaignId]
  );

  console.log(`🎉 Campaign ${campaignId} completed from ${user.gmail_address}: ${sentCount} sent, ${failedCount} failed`);
}

// Updated individual email sending function
async function sendSingleEmailWithUserGmail(campaignId, campaign, contact, user, userTransporter) {
  // Generate tracking ID
  const trackingId = require('uuid').v4();

  // Create tracking record
  await new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO email_tracking (campaign_id, contact_id, email, tracking_id) VALUES (?, ?, ?, ?)',
      [campaignId, contact.id, contact.email, trackingId],
      (err) => err ? reject(err) : resolve()
    );
  });

  // Personalize content with user data
  const personalizedSubject = personalizeContent(campaign.subject, contact, { ...campaign, user_name: user.name });
  let personalizedHtml = personalizeContent(campaign.html_body, contact, { ...campaign, user_name: user.name });
  const personalizedText = personalizeContent(campaign.text_body, contact, { ...campaign, user_name: user.name });

  // Add tracking
  const baseUrl = process.env.BASE_URL || 'https://email-campaign-system.onrender.com';
  const trackingPixel = `<img src="${baseUrl}/track/open/${trackingId}" width="1" height="1" style="display:none;" alt="">`;
  personalizedHtml += trackingPixel;

  // Add user's signature
  if (user.signature) {
    personalizedHtml += '<br><br>' + user.signature.replace(/\n/g, '<br>');
  }

  // Send email using user's Gmail
  await userTransporter.sendMail({
    from: `"${user.name}" <${user.gmail_address}>`,
    to: contact.email,
    subject: personalizedSubject,
    html: personalizedHtml,
    text: personalizedText + (user.signature ? '\n\n' + user.signature : ''),
    headers: {
      'Reply-To': user.gmail_address,
      'X-Priority': '3',
      'X-Mailer': 'Personal'
    }
  });

  // Mark contact as contacted
  await new Promise((resolve, reject) => {
    db.run(
      'UPDATE contacts SET contacted = 1, last_contacted = CURRENT_TIMESTAMP WHERE id = ?',
      [contact.id],
      (err) => err ? reject(err) : resolve()
    );
  });

  // Log success
  await logOutreach(campaignId, contact.id, contact.email, 'sent', personalizedSubject);
}

// Function to process links for click tracking
async function processLinksForTracking(htmlContent, trackingId) {
  const linkRegex = /<a\s+(?:[^>]*?\s+)?href\s*=\s*["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
  let linkIndex = 0;
  const trackedLinks = [];

  const processedHtml = htmlContent.replace(linkRegex, (match, url, linkText) => {
    linkIndex++;

    // Store original URL for tracking
    trackedLinks.push({
      index: linkIndex,
      originalUrl: url,
      trackingId: trackingId
    });

    // Create tracking URL
    const trackingUrl = `${BASE_URL}/track/click/${trackingId}/${linkIndex}`;

    // Return modified link
    return `<a href="${trackingUrl}">${linkText}</a>`;
  });

  // Store tracked links in database
  for (const link of trackedLinks) {
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO tracked_links (tracking_id, original_url) VALUES (?, ?)',
        [link.trackingId, link.originalUrl],
        (err) => err ? reject(err) : resolve()
      );
    });
  }

  return processedHtml;
}

function personalizeContent(content, contact, campaign) {
  if (!content) return '';

  const customFields = JSON.parse(contact.custom_fields || '{}');

  let personalized = content
    .replace(/\{\{name\}\}/g, contact.name || 'there')
    .replace(/\{\{firstName\}\}/g, contact.name ? contact.name.split(' ')[0] : 'there')
    .replace(/\{\{email\}\}/g, contact.email)
    .replace(/\{\{company\}\}/g, contact.company || 'your company')
    .replace(/\{\{position\}\}/g, contact.position || 'your role')
    .replace(/\{\{linkedin\}\}/g, contact.linkedin_url || '')
    .replace(/\{\{myName\}\}/g, campaign.user_name || '');

  // Handle custom fields
  personalized = personalized.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    return customFields[key] || match;
  });

  return personalized;
}

async function logOutreach(campaignId, contactId, email, status, subject, notes = null) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO email_logs (campaign_id, contact_id, email, status, subject, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [campaignId, contactId, email, status, subject, notes],
      (err) => {
        if (err) {
          console.error('Error logging outreach:', err);
          reject(err);
        } else {
          console.log(`📝 Logged outreach: ${email} - ${status}`);
          resolve();
        }
      }
    );
  });
}

// =============================================================================
// BULK CONTACT IMPORT
// =============================================================================

app.post('/api/contacts/bulk', authenticateToken, (req, res) => {
  const { contacts } = req.body;

  if (!Array.isArray(contacts)) {
    return res.status(400).json({ error: 'Contacts must be an array' });
  }

  const stmt = db.prepare(
    'INSERT OR REPLACE INTO contacts (user_id, name, email, company, position, linkedin_url, notes, custom_fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  let successCount = 0;
  let errorCount = 0;

  contacts.forEach(contact => {
    stmt.run([
      req.user.userId,
      contact.name || '',
      contact.email,
      contact.company || '',
      contact.position || '',
      contact.linkedinUrl || '',
      contact.notes || '',
      JSON.stringify(contact.customFields || {})
    ], (err) => {
      if (err) {
        errorCount++;
      } else {
        successCount++;
      }
    });
  });

  stmt.finalize((err) => {
    if (err) throw err;
    console.log(`✅ Bulk import: ${successCount} contacts added`);
    res.json({
      message: 'Bulk import completed',
      successful: successCount,
      errors: errorCount
    });
  });
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =============================================================================
// START SERVER
// =============================================================================

async function startServer() {
  const server = app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                    💼 PROFESSIONAL COLD EMAIL SYSTEM                         ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  Web Interface: http://localhost:${PORT}                                        ║
║  Database: ./data/cold_email_system.db                                       ║
║  Email Service: Individual User Gmail Accounts                               ║
║                                                                               ║
║  🎯 Users configure their own Gmail in Settings tab                          ║
╚═══════════════════════════════════════════════════════════════════════════════╝

💼 PROFESSIONAL COLD EMAIL FEATURES:
   ✅ Individual Gmail accounts for each user
   ✅ Personal sender identity (appears from user's Gmail)
   ✅ No unsubscribe links or campaign branding
   ✅ Professional sending rate (30s delays)
   ✅ Contact management with company/position
   ✅ Personalized templates with {{name}}, {{company}}, etc.
   ✅ Response tracking and follow-up management

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
    `);
  });

  return server;
}

startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});

// Add graceful shutdown handling:
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  if (emailTransporter) {
    emailTransporter.close();
  }
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});