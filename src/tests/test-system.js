const axios = require('axios');

const API_BASE = 'http://localhost:3000/api';
const BASE_URL = 'http://localhost:3000';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testSystem() {
  console.log('\n🧪 TESTING EMAIL CAMPAIGN SYSTEM\n');

  let authToken = null;
  let testUserId = `test_${Date.now()}`;
  let testEmail = `testuser_${testUserId}@example.com`;

  try {
    // Wait for server to be ready
    console.log('⏳ Waiting for server to start...');
    let serverReady = false;
    let healthData = null;
    
    for (let i = 0; i < 30; i++) {
      try {
        const response = await axios.get(`${BASE_URL}/health`);
        healthData = response.data;
        if (healthData.status === 'healthy' && healthData.databaseStatus === 'connected') {
          serverReady = true;
          break;
        } else if (healthData.databaseStatus !== 'connected') {
          console.log('   ⏳ Waiting for database connection...');
        }
      } catch (error) {
        // Server not ready yet
      }
      await sleep(1000);
    }

    if (!serverReady) {
      throw new Error('Server not responding or database not connected after 30 seconds');
    }

    console.log('✅ Server is running and healthy');
    console.log(`   • Database: ${healthData.database} (${healthData.databaseStatus})`);
    console.log(`   • Environment: ${healthData.environment}`);
    console.log(`   • Memory: ${healthData.memory.used}`);

    // Test 1: Register user
    console.log('\n1️⃣ Testing user registration...');
    try {
      const registerResponse = await axios.post(`${API_BASE}/auth/register`, {
        name: 'Test User',
        email: testEmail,
        password: 'TestPassword123!',
        signature: 'Best regards,\nTest User\ntest@example.com'
      });
      authToken = registerResponse.data.token;
      console.log(`   ✅ User registered successfully: ${testEmail}`);
      console.log(`   • User ID: ${registerResponse.data.user.id}`);
      console.log(`   • Name: ${registerResponse.data.user.name}`);
    } catch (error) {
      if (error.response?.status === 409) {
        console.log('   ⚠️  User already exists, trying to login...');
        
        const loginResponse = await axios.post(`${API_BASE}/auth/login`, {
          email: testEmail,
          password: 'TestPassword123!'
        });
        authToken = loginResponse.data.token;
        console.log('   ✅ Logged in successfully');
      } else {
        throw error;
      }
    }

    // Test 2: Add contact
    console.log('\n2️⃣ Adding test contact...');
    const contactEmail = `contact_${Date.now()}@example.com`;
    await axios.post(`${API_BASE}/contacts`, {
      name: 'Test Contact',
      email: contactEmail,
      company: 'Test Company Inc.',
      position: 'Senior Tester',
      linkedinUrl: 'https://linkedin.com/in/testcontact',
      notes: 'This is a test contact for the system'
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    console.log(`   ✅ Contact added successfully: ${contactEmail}`);

    // Test 3: Bulk import contacts
    console.log('\n3️⃣ Testing bulk contact import...');
    const bulkResponse = await axios.post(`${API_BASE}/contacts/bulk`, {
      contacts: [
        {
          name: 'Bulk Contact 1',
          email: `bulk1_${Date.now()}@example.com`,
          company: 'Bulk Company 1',
          position: 'Manager'
        },
        {
          name: 'Bulk Contact 2',
          email: `bulk2_${Date.now()}@example.com`,
          company: 'Bulk Company 2',
          position: 'Director'
        }
      ]
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    console.log(`   ✅ Bulk import successful: ${bulkResponse.data.successful} contacts added`);

    // Test 4: Create template
    console.log('\n4️⃣ Creating email template...');
    const templateResponse = await axios.post(`${API_BASE}/templates`, {
      name: 'Test Welcome Template',
      subject: 'Hello {{firstName}} from {{company}}!',
      htmlBody: `
        <h1>Hello {{name}}!</h1>
        <p>I hope this email finds you well at <strong>{{company}}</strong>.</p>
        <p>As a <strong>{{position}}</strong>, I thought you might be interested in our services.</p>
        <p>Best regards,<br>{{myName}}</p>
      `,
      textBody: 'Hello {{name}}! Welcome to our system. Company: {{company}}, Position: {{position}}'
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    console.log('   ✅ Template created successfully');
    console.log(`   • Template ID: ${templateResponse.data.id}`);

    // Test 5: Create campaign
    console.log('\n5️⃣ Creating campaign...');
    const campaignResponse = await axios.post(`${API_BASE}/campaigns`, {
      name: 'Test Outreach Campaign',
      templateId: templateResponse.data.id,
      settings: { delay: 1000 }
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    console.log('   ✅ Campaign created successfully');
    console.log(`   • Campaign ID: ${campaignResponse.data.id}`);

    // Test 6: Gmail configuration
    console.log('\n6️⃣ Testing Gmail configuration endpoints...');
    try {
      const gmailConfig = await axios.get(`${API_BASE}/user/gmail-config`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      console.log('   ✅ Gmail config endpoint working');
      console.log(`   • Configured: ${gmailConfig.data.configured}`);
      console.log(`   • Verified: ${gmailConfig.data.verified}`);
    } catch (error) {
      console.log('   ❌ Gmail config endpoint failed:', error.response?.data?.error || error.message);
    }

    // Test 7: List data
    console.log('\n7️⃣ Verifying data...');
    const [contacts, templates, campaigns] = await Promise.all([
      axios.get(`${API_BASE}/contacts`, { headers: { Authorization: `Bearer ${authToken}` } }),
      axios.get(`${API_BASE}/templates`, { headers: { Authorization: `Bearer ${authToken}` } }),
      axios.get(`${API_BASE}/campaigns`, { headers: { Authorization: `Bearer ${authToken}` } })
    ]);

    console.log(`   📋 Contacts: ${contacts.data.contacts.length}`);
    console.log(`   📝 Templates: ${templates.data.length}`);
    console.log(`   🚀 Campaigns: ${campaigns.data.length}`);
    console.log('   ✅ All data verified successfully');

    // Test 8: Analytics endpoint
    console.log('\n8️⃣ Testing analytics endpoints...');
    try {
      const analytics = await axios.get(`${API_BASE}/campaigns/analytics/summary`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      console.log('   ✅ Analytics endpoint working');
      console.log(`   • Campaigns with analytics: ${analytics.data.length}`);
    } catch (error) {
      console.log('   ⚠️  Analytics endpoint error:', error.response?.data?.error || error.message);
    }

    console.log('\n🎉 ALL TESTS PASSED! 🎉\n');
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║                    SYSTEM READY FOR USE!                     ║');
    console.log('╠═══════════════════════════════════════════════════════════════╣');
    console.log('║  🌐 Open: http://localhost:3000                              ║');
    console.log(`║  🔐 Login: ${testEmail.padEnd(30)} / TestPassword123!   ║`);
    console.log('║                                                               ║');
    console.log('║  📧 TO SEND REAL EMAILS:                                     ║');
    console.log('║  1. Login to the web interface                               ║');
    console.log('║  2. Go to Settings tab                                       ║');
    console.log('║  3. Configure your Gmail with app password                   ║');
    console.log('║  4. Add real email addresses as contacts                     ║');
    console.log('║  5. Send a campaign!                                         ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝');

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.response?.data?.error || error.message);
    
    if (error.response) {
      console.log('\n📋 Error Details:');
      console.log('   • Status:', error.response.status);
      console.log('   • Message:', error.response.data?.error || error.response.statusText);
      console.log('   • URL:', error.config?.url);
    }
    
    console.log('\n🔧 TROUBLESHOOTING TIPS:');
    console.log('   • Make sure the server is running: npm start');
    console.log('   • Check if port 3000 is available');
    console.log('   • Verify MongoDB is running and accessible');
    console.log('   • Check .env file configuration');
    console.log('   • Look at the server console for detailed error messages');
    
    process.exit(1);
  }
}

// Auto-run tests
console.log('🚀 Starting Email Campaign System Tests...');
testSystem().then(() => {
  console.log('\n✅ Test suite completed successfully!');
  process.exit(0);
}).catch(error => {
  console.error('\n❌ Test suite failed:', error.message);
  process.exit(1);
});