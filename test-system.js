const axios = require('axios');

const API_BASE = 'http://localhost:3000/api';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testSystem() {
  console.log('\n🧪 TESTING EMAIL CAMPAIGN SYSTEM\n');

  try {
    // Wait for server to be ready
    console.log('⏳ Waiting for server to start...');
    let serverReady = false;
    for (let i = 0; i < 30; i++) {
      try {
        await axios.get('http://localhost:3000/health');
        serverReady = true;
        break;
      } catch (error) {
        await sleep(1000);
      }
    }

    if (!serverReady) {
      throw new Error('Server not responding after 30 seconds');
    }

    console.log('✅ Server is running');

    // Test 1: Register user
    console.log('\n1️⃣ Testing user registration...');
    const registerResponse = await axios.post(`${API_BASE}/auth/register`, {
      email: 'testuser@example.com',
      password: 'TestPassword123!'
    });
    const authToken = registerResponse.data.token;
    console.log('   ✅ User registered successfully');

    // Test 2: Add recipient
    console.log('\n2️⃣ Adding test recipient...');
    await axios.post(`${API_BASE}/recipients`, {
      name: 'Test Recipient',
      email: 'recipient@example.com',
      customFields: { company: 'Test Company', position: 'Tester' }
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    console.log('   ✅ Recipient added successfully');

    // Test 3: Create template
    console.log('\n3️⃣ Creating email template...');
    const templateResponse = await axios.post(`${API_BASE}/templates`, {
      name: 'Welcome Email Template',
      subject: 'Welcome {{name}} from {{company}}!',
      htmlBody: `
        <h1>Hello {{name}}!</h1>
        <p>Welcome to our email campaign system.</p>
        <p>We see you work at <strong>{{company}}</strong> as a <strong>{{position}}</strong>.</p>
        <p>Your email address is: {{email}}</p>
        <p>Thank you for testing our system!</p>
      `,
      textBody: 'Hello {{name}}! Welcome to our system. Email: {{email}}'
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    console.log('   ✅ Template created successfully');

    // Test 4: Create campaign
    console.log('\n4️⃣ Creating campaign...');
    const campaignResponse = await axios.post(`${API_BASE}/campaigns`, {
      name: 'Test Welcome Campaign',
      templateId: templateResponse.data.id,
      settings: { delay: 1000 }
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    console.log('   ✅ Campaign created successfully');

    // Test 5: List data
    console.log('\n5️⃣ Verifying data...');
    const [recipients, templates, campaigns] = await Promise.all([
      axios.get(`${API_BASE}/recipients`, { headers: { Authorization: `Bearer ${authToken}` } }),
      axios.get(`${API_BASE}/templates`, { headers: { Authorization: `Bearer ${authToken}` } }),
      axios.get(`${API_BASE}/campaigns`, { headers: { Authorization: `Bearer ${authToken}` } })
    ]);

    console.log(`   📋 Recipients: ${recipients.data.recipients.length}`);
    console.log(`   📝 Templates: ${templates.data.length}`);
    console.log(`   🚀 Campaigns: ${campaigns.data.length}`);
    console.log('   ✅ All data verified successfully');

    console.log('\n🎉 ALL TESTS PASSED! 🎉\n');
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║                    SYSTEM READY FOR USE!                     ║');
    console.log('╠═══════════════════════════════════════════════════════════════╣');
    console.log('║  🌐 Open: http://localhost:3000                              ║');
    console.log('║  🔐 Login: testuser@example.com / TestPassword123!           ║');
    console.log('║                                                               ║');
    console.log('║  📧 TO SEND REAL EMAILS:                                     ║');
    console.log('║  1. Configure Gmail in .env file                             ║');
    console.log('║  2. Add your email as a recipient                            ║');
    console.log('║  3. Send a campaign to test it!                              ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝');

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.response?.data?.error || error.message);
    console.log('\n🔧 TROUBLESHOOTING TIPS:');
    console.log('   • Make sure the server is running: npm start');
    console.log('   • Check if port 3000 is available');
    console.log('   • Look at the server console for error messages');
  }
}

// Auto-run tests
testSystem();
