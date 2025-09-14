// frontend/script.js

/**
 * This is the main function that runs when the page is loaded.
 * It checks which HTML page is currently open and calls the appropriate
 * functions to fetch and display data for that page.
 */
// Wait for DOM to be ready

// This gatekeeper runs on every single page
// At the top of frontend/script.js
const authManager = {
    token: null,
    user: null,

    setAuth(token, user) {
        this.token = token;
        this.user = user;
    },

    clearAuth() {
        this.token = null;
        this.user = null;
    },

    isAuthenticated() {
        return !!this.token;
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    
    // Define all pages that DO NOT require a login check
    const publicPages = ['login.html', 'register.html', 'landing.html'];
    
    // Define all ADMIN pages
    const adminPages = ['admin.html', 'admin_users.html', 'admin_plans.html'];

    if (publicPages.includes(currentPage)) {
        // If we are on a public page, just set up its specific listeners
        if (currentPage === 'login.html') {
            document.getElementById('login-form').addEventListener('submit', handleLogin);
        } else if (currentPage === 'register.html') {
            document.getElementById('register-form').addEventListener('submit', handleRegister);
        }
        return; // Stop further execution for public pages
    }

    // ...existing code...

    try {
         const storedToken = sessionStorage.getItem('authToken');
        console.log('[DEBUG] Fetching /api/users/me to check session...');
        const response = await fetch('/api/users/me', { credentials: 'include' });
       // persistDebug('[DEBUG] /api/users/me response status: ' + response.status);
        console.log('[DEBUG] /api/users/me response status:', response.status);
        if (!response.ok) {
           // persistDebug('[DEBUG] Not logged in, redirecting to login.html');
            console.log('[DEBUG] Not logged in, redirecting to login.html');
            window.location.href = 'login.html';
            return;
        }

        const user = await response.json();
         authManager.setAuth(storedToken || "from_cookie", user);
     //  persistDebug('[DEBUG] /api/users/me response data: ' + JSON.stringify(user));
        console.log('[DEBUG] /api/users/me response data:', user);

        // Security Check: If a regular user tries to access an admin page, redirect them.
        if (adminPages.includes(currentPage) && user.role !== 'admin') {
           // persistDebug('Access denied. You must be an admin to view this page.');
            alert('Access denied. You must be an admin to view this page.');
            window.location.href = 'index.html'; // Send them to their user dashboard
            return;
        }

        // If all checks pass, initialize the page's specific functions
        initializeDashboardPage(currentPage);

    } catch (error) {
       // persistDebug('[DEBUG] Authentication check failed: ' + error);
        console.error('[DEBUG] Authentication check failed:', error);
        window.location.href = 'login.html';
    }
});
// Additional safety: prevent any form submission
window.addEventListener('beforeunload', function() {
    console.log('[DEBUG] Page unloading...');
});

function initializeDashboardPage(currentPage) {
    // Attach the universal logout button listener (safe)
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }

    // Run the specific functions for the current dashboard page

    // This switch statement now handles attaching the correct button listeners for each page
    switch (currentPage) {
        case 'index.html':
            fetchDashboardStats();
            connectLogWebSocket();
            break;
        case 'accounts.html':
            fetchAccounts();
            addRemoveAccountListeners();
            // Attach listener for the "Add New Account" button
            document.getElementById('add-account-btn').addEventListener('click', startAddAccountProcess);
            break;
        case 'forwarding.html':
            fetchForwardingRules();
            // Attach listener for the "Add New Rule" button
            document.getElementById('add-rule-btn').addEventListener('click', showAddRuleModal);
            // Attach listener for the "Save" button inside the modal
            document.getElementById('save-rule-btn').addEventListener('click', saveForwardingRule);
            break;
        case 'joiner.html': // NEW
            populateJoinerAccountList();
            document.getElementById('start-joining-btn').addEventListener('click', startJoiningProcess);
            break;
        case 'auto-reply.html': // NEW
            populateAutoReplyAccountList();
            document.getElementById('save-settings-btn').addEventListener('click', saveAutoReplySettings);
            // Add a listener to fetch settings when an account is selected
            document.getElementById('account-select').addEventListener('change', fetchAutoReplySettings);
            break;
        case 'validator.html': // NEW
            document.getElementById('validate-link-btn').addEventListener('click', validateLink);
            break;
        case 'extractor.html': // NEW
            populateExtractorAccountList();
            document.getElementById('start-extraction-btn').addEventListener('click', startExtractionProcess);
            document.getElementById('copy-all-btn').addEventListener('click', copyExtractedData);
            document.getElementById('download-csv-btn').addEventListener('click', downloadExtractedDataAsCSV);
            break;
        case 'forward-config.html': // NEW
            populateForwardConfigAccountList();
            document.getElementById('start-forwarding-btn').addEventListener('click', startForwardingJob);
            break;
        case 'smart-selling.html': // NEW
            populateSmartSellingAccountList();
            document.getElementById('save-config-btn').addEventListener('click', saveSmartSellingConfig);
            document.getElementById('account-select').addEventListener('change', fetchSmartSellingConfig);
            break;
        case 'admin.html':
            fetchAdminDashboardStats();
            break;
        case 'admin_users.html':
            fetchAdminUsers();
            break;
        case 'admin_plans.html':
            fetchAdminPlans();
            initializePlanModal();
            break;
    }
};

// --- Authentication Handlers ---
async function authFetch(url, options = {}) {
    try {
        const response = await fetch(url, {
            ...options,
            credentials: "include" // always send cookies
        });
        if (!response.ok) {
            throw new Error(`Request failed: ${response.status}`);
        }
        return response.json();
    } catch (err) {
        console.error(`authFetch error for ${url}:`, err);
        throw err; // propagate to caller
    }
}

let isSubmitting = false; // Prevent double submission

// In frontend/script.js


// A simpler and more efficient version of handleLogin
async function handleLogin(event) {
    event.preventDefault();
    
    // Prevent double submission
    if (isSubmitting) return;
    isSubmitting = true;
    
    const form = event.target;
    const formData = new FormData(form);
    const errorDiv = document.getElementById('error-message');
    const submitButton = form.querySelector('button[type="submit"]');
    
    // Update UI to show loading state
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Logging in...';
    }
    
    try {
        const response = await fetch('/api/token', {
            method: 'POST',
            body: formData,
            credentials: 'include'
        });

        console.log(response)
        const result = await response.json();
        
        if (response.ok) {
            //authManager.setAuth(result.access_token, { role: result.role });
            console.log(result)
             // Store the token in sessionStorage
            sessionStorage.setItem('authToken', result.access_token);
            
            // Also update the authManager
            authManager.setAuth(result.access_token, { role: result.role });

            // If login is successful, the cookie is set.
            // Redirect DIRECTLY to the correct page. The gatekeeper script
            // on that NEXT page will handle the verification.
            console.log('[DEBUG] Login response:', result);
            if (result.role === 'admin') {
                console.log('[DEBUG] Redirecting to admin.html');
                window.location.href = '/admin.html';
            } else {
                console.log('[DEBUG] Redirecting to index.html');
                window.location.href = '/index.html';
            }
            
        } else {
            const data = await response.json();
            errorDiv.textContent = data.detail || 'Login failed';
            errorDiv.style.display = 'block';
        }
    } catch (err) {
        errorDiv.textContent = `Error: ${err.message}`;
        errorDiv.style.display = 'block';
    } finally {
        // Reset form state (the redirect will usually happen before this, but it's good practice)
        isSubmitting = false;
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = 'Login';
        }
    }
}



// In frontend/script.js

async function handleRegister(event) {
    event.preventDefault();
    const form = event.target;
    const errorDiv = document.getElementById('error-message');
    const successDiv = document.getElementById('success-message');

    // Manually get the values from the form
    const username = form.querySelector('#username').value;
    const password = form.querySelector('#password').value;

    // Create a JSON object
    const userData = {
        username: username,
        password: password
    };

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            // Set the correct header for sending JSON
            headers: {
                'Content-Type': 'application/json',
            },
            // Send the JSON object as a string
            body: JSON.stringify(userData),
        });
        
        if (response.ok) {
            successDiv.textContent = 'Registration successful! You can now log in.';
            successDiv.style.display = 'block';
            errorDiv.style.display = 'none';
            form.reset();
        } else {
            const error = await response.json();
            errorDiv.textContent = error.detail || 'Registration failed.';
            errorDiv.style.display = 'block';
            successDiv.style.display = 'none';
        }
    } catch (err) {
        errorDiv.textContent = 'An error occurred. Please try again.';
        errorDiv.style.display = 'block';
    }
}

async function saveForwardingRule() {
    const rule = {
        account_phone: document.getElementById('account-select').value,
        source_chat: document.getElementById('source-chat').value,
        destination_chat: document.getElementById('destination-chat').value,
        filters: document.getElementById('filters').value,
    };

    if (!rule.account_phone || !rule.source_chat || !rule.destination_chat) {
        alert('Please fill out all required fields.');
        return;
    }

    try {
        const response = await fetch('/api/rules/forwarding', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rule),
        });
        if (!response.ok) throw new Error('Failed to save rule.');

        // Hide the modal manually
        const addRuleModalElement = document.getElementById('addRuleModal');
        const addRuleModal = bootstrap.Modal.getInstance(addRuleModalElement);
        addRuleModal.hide();

        await fetchForwardingRules(); // Refresh the table
    } catch (error) {
        console.error("Error saving rule:", error);
        alert(`Error: ${error.message}`);
    }
}

// --- API Functions ---
// These functions use the fetch() API to communicate with your Python backend.

async function showAddRuleModal() {
    const addRuleModalElement = document.getElementById('addRuleModal');
    if (!addRuleModalElement) return;

    const addRuleModal = new bootstrap.Modal(addRuleModalElement);
    const accountSelect = document.getElementById('account-select');

    // Fetch active accounts to populate the dropdown
    try {
        const response = await fetch('/api/accounts');
        const accounts = await response.json();
        accountSelect.innerHTML = '<option value="">Select an account...</option>'; // Clear previous options
        accounts.forEach(acc => {
            if (acc.status === 'Online') { // Only show online accounts
                accountSelect.innerHTML += `<option value="${acc.phone}">${acc.phone}</option>`;
            }
        });
    } catch (error) {
        console.error("Failed to fetch accounts for modal:", error);
    }
    addRuleModal.show();
}

/**
 * Fetches statistics for the main dashboard overview page.
 * It calls multiple API endpoints to get the data.
 */

async function fetchDashboardStats() {
    console.log("Fetching dashboard stats...");

    try {
        const accounts = await authFetch('/api/accounts');
        document.getElementById('active-accounts').textContent = accounts.length;

        const rules = await authFetch('/api/rules/forwarding');
        document.getElementById('forwarding-rules').textContent = rules.length;

        document.getElementById('messages-today').textContent = "1,432"; // placeholder
        console.log("Dashboard stats updated successfully.");
    } catch (error) {
        console.error("Error fetching dashboard stats:", error);
    }
}

/**
 * Fetches the list of managed accounts and populates the table on accounts.html.
 */

/**
 * Fetches the list of forwarding rules and populates the table on forwarding.html.
 */
async function fetchForwardingRules() {
    console.log("Fetching forwarding rules from backend...");
    try {
        const response = await fetch('/api/rules/forwarding',{
            credentials: "include"
        });
        const rules = await response.json();

        const tableBody = document.getElementById('forwarding-rules-table-body');
        tableBody.innerHTML = '';

        if (rules.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="5" class="text-center">No forwarding rules configured.</td></tr>`;
            return;
        }

        rules.forEach(rule => {
            const statusClass = rule.status === 'Active' ? 'text-success' : 'text-warning';
            const row = `
                <tr>
                    <td><strong class="${statusClass}">${rule.status}</strong></td>
                    <td>${rule.source_chat}</td>
                    <td>${rule.destination_chat}</td>
                    <td>${rule.filters || 'None'}</td>
                    <td><button class="btn btn-danger btn-sm">Delete</button></td>
                </tr>
            `;
            tableBody.innerHTML += row;
        });
    } catch (error) {
        console.error("Error fetching forwarding rules:", error);
    }
}

function addForwardingRuleListeners() {
    const addRuleBtn = document.querySelector('main .btn-primary');
    const addRuleModalElement = document.getElementById('addRuleModal');
    
    if (!addRuleBtn || !addRuleModalElement) return;

    const addRuleModal = new bootstrap.Modal(addRuleModalElement);
    const saveRuleBtn = document.getElementById('save-rule-btn');
    const accountSelect = document.getElementById('account-select');

    // When "Add New Rule" is clicked, populate the dropdown and show the modal
    addRuleBtn.addEventListener('click', async () => {
        // Fetch active accounts to populate the dropdown
        try {
            const response = await fetch('/api/accounts', {
                credentials: "include"
            });
            const accounts = await response.json();
            accountSelect.innerHTML = '<option value="">Select an account...</option>'; // Clear previous options
            accounts.forEach(acc => {
                if (acc.status === 'Online') { // Only show online accounts
                    accountSelect.innerHTML += `<option value="${acc.phone}">${acc.phone}</option>`;
                }
            });
        } catch (error) {
            console.error("Failed to fetch accounts for modal:", error);
        }
        addRuleModal.show();
    });

    // When "Save Rule" is clicked in the modal
    saveRuleBtn.addEventListener('click', async () => {
        const rule = {
            account_phone: document.getElementById('account-select').value,
            source_chat: document.getElementById('source-chat').value,
            destination_chat: document.getElementById('destination-chat').value,
            filters: document.getElementById('filters').value,
        };

        if (!rule.account_phone || !rule.source_chat || !rule.destination_chat) {
            alert('Please fill out all required fields.');
            return;
        }

        try {
            const response = await fetch('/api/rules/forwarding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(rule),
                credentials: "include"
            });
            if (!response.ok) throw new Error('Failed to save rule.');
            
            addRuleModal.hide();
            await fetchForwardingRules(); // Refresh the table
        } catch (error) {
            console.error("Error saving rule:", error);
            alert(`Error: ${error.message}`);
        }
    });
}

/**
 * SIMULATED: This function simulates live log updates.
 * In a real-world application, this would be replaced by a WebSocket connection
 * for true real-time updates from the server.
 */
function simulateLiveLogs() {
    const logContent = document.getElementById('log-content');
    if (!logContent) return;
    
    logContent.textContent = ''; // Clear initial message
    let logCounter = 0;
    
    const logs = [
        "[INFO] System initialized. Waiting for tasks.",
        "[SUCCESS] Account +15551234567 connected successfully.",
        "[INFO] Forwarding message from 'Crypto Signals' to 'My VIP Members'.",
        "[SUCCESS] Message 1234 forwarded.",
        "[WARN] Rate limit detected on account +442079460958. Pausing for 30s.",
        "[INFO] Joining group 'https://t.me/somegroup'...",
        "[ERROR] Failed to join group. It may be private or the link is invalid."
    ];

    setInterval(() => {
        const now = new Date();
        const time = now.toTimeString().split(' ')[0];
        const newLog = `[${time}] ${logs[logCounter % logs.length]}\n`;
        logContent.textContent += newLog;
        logContent.scrollTop = logContent.scrollHeight; // Auto-scroll to bottom
        logCounter++;
    }, 3000);
}
// (Add this to the bottom of frontend/script.js)

// --- Add Account WebSocket Logic ---
/**
 * Fetches accounts and populates the table.
 * NEW: Adds a data-phone attribute to each remove button.
 */
async function fetchAccounts() {
    console.log("Fetching accounts list from backend...");
    try {
        const response = await fetch('/api/accounts',{
            credentials: "include"
        });
        const accounts = await response.json();

        const tableBody = document.getElementById('accounts-table-body');
        tableBody.innerHTML = ''; // Clear existing content

        if (accounts.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="4" class="text-center">No accounts added yet.</td></tr>`;
            return;
        }

        accounts.forEach(account => {
            const statusClass = account.status === 'Online' ? 'text-success' : 'text-warning';
            
            // Note the new class 'remove-btn' and the 'data-phone' attribute on the button
            const row = `
                <tr>
                    <td>${account.phone}</td>
                    <td><strong class="${statusClass}">${account.status}</strong></td>
                    <td>${account.added_on}</td>
                    <td>
                        <button class="btn btn-danger btn-sm remove-btn" data-phone="${account.phone}">
                            Remove
                        </button>
                    </td>
                </tr>
            `;
            tableBody.innerHTML += row;
        });
        console.log("Accounts table updated.");
    } catch (error) {
        console.error("Error fetching accounts:", error);
    }
}

// Find the "Add New Account" button on the accounts page
const addAccountBtn = document.querySelector('main .btn-primary');
if (addAccountBtn && window.location.pathname.includes('accounts.html')) {
    addAccountBtn.addEventListener('click', startAddAccountProcess);
}

let ws; // Keep the WebSocket connection in a global variable

function startAddAccountProcess() {
    const modalElement = document.getElementById('addAccountModal');
    const modal = new bootstrap.Modal(modalElement);
    // Use the token from the auth manager
    console.log(authManager)


     // Use the token from the auth manager
    if (!authManager.token || authManager.token === "from_cookie") {
        // If the token is missing (e.g., after a page refresh), prompt the user to log in again.
        alert("Session requires re-authentication for this action. Please log out and log back in.");
        // A more advanced solution would be to use a refresh token flow.
        return;
    }
    const token = authManager.token;
    
    modal.show();
    
    
    const promptText = document.getElementById('modal-prompt-text');
    const statusText = document.getElementById('modal-status-text');
    const inputGroup = document.getElementById('modal-input-group');
    const inputField = document.getElementById('modal-input');
    const submitBtn = document.getElementById('modal-submit-btn');

    // Reset modal to initial state
    promptText.textContent = 'Connecting to server...';
    statusText.textContent = '';
    inputGroup.style.display = 'none';
    submitBtn.style.display = 'none';
    submitBtn.disabled = false;

    
    modal.show();

    // Establish WebSocket connection
    ws = new WebSocket(`ws://${window.location.host}/ws/add_account?token=${token}`);
    console.log(ws)

    ws.onopen = () => {
        console.log("WebSocket connection established.");
        promptText.textContent = "Connection successful. Waiting for instructions...";
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log("Received message from server:", data);

        switch(data.type) {
            case 'prompt':
                promptText.textContent = data.message;
                inputField.value = '';
                inputGroup.style.display = 'block';
                submitBtn.style.display = 'block';
                inputField.focus();
                break;
            case 'success':
                promptText.textContent = 'Success!';
                statusText.textContent = data.message;
                statusText.style.color = 'var(--bs-success)';
                inputGroup.style.display = 'none';
                submitBtn.style.display = 'none';
                fetchAccounts(); // Refresh the accounts table
                break;
            case 'error':
                promptText.textContent = 'Error!';
                statusText.textContent = data.message;
                statusText.style.color = 'var(--bs-danger)';
                inputGroup.style.display = 'none';
                submitBtn.disabled = true; // Prevent further submissions
                break;
        }
    };
    
    ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        promptText.textContent = 'Connection Error';
        statusText.textContent = 'Could not connect to the server. Please ensure it is running and refresh the page.';
        statusText.style.color = 'var(--bs-danger)';
    };

    ws.onclose = () => {
        console.log("WebSocket connection closed.");
    };

    // Handle the submit button inside the modal
    submitBtn.onclick = () => {
        const responseData = inputField.value.trim();
        if (responseData) {
            ws.send(JSON.stringify({ type: 'response', data: responseData }));
            promptText.textContent = "Processing, please wait...";
            inputGroup.style.display = 'none';
            submitBtn.style.display = 'none';
        }
    };
    
    // Also handle Enter key press
    inputField.onkeypress = (e) => {
        if (e.key === 'Enter') {
            submitBtn.click();
        }
    };
}
function addRemoveAccountListeners() {
    const tableBody = document.getElementById('accounts-table-body');

    // This listener is attached to the whole table body.
    // It checks if a click happened on a button with the 'remove-btn' class.
    tableBody.addEventListener('click', async (event) => {
        if (event.target && event.target.classList.contains('remove-btn')) {
            const phone = event.target.dataset.phone;

            // Ask for confirmation before deleting
            if (confirm(`Are you sure you want to remove the account ${phone}? This cannot be undone.`)) {
                try {
                    const response = await fetch(`/api/accounts/${phone}`, {
                        method: 'DELETE',
                    });

                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.detail || 'Failed to remove account');
                    }

                    console.log(`Account ${phone} removed.`);
                    
                    // Refresh the table to show the updated list
                    await fetchAccounts(); 

                } catch (error) {
                    console.error("Error removing account:", error);
                    alert(`Error: ${error.message}`);
                }
            }
        }
    });
}

async function populateJoinerAccountList() {
    const accountSelect = document.getElementById('account-select');
    if (!accountSelect) return;

    try {
        const response = await fetch('/api/accounts', {
            credentials: 'include'
        });
        const accounts = await response.json();
        accountSelect.innerHTML = '<option value="">Select an account...</option>';
        accounts.forEach(acc => {
            if (acc.status === 'Online') {
                accountSelect.innerHTML += `<option value="${acc.phone}">${acc.phone}</option>`;
            }
        });
    } catch (error) {
        console.error("Failed to fetch accounts for joiner:", error);
    }
}

// --- NEW Functions for Group Joiner Page ---

async function startJoiningProcess() {
    const accountPhone = document.getElementById('account-select').value;
    const groupLinksText = document.getElementById('group-links').value;
    const startBtn = document.getElementById('start-joining-btn');
    const linksTextarea = document.getElementById('group-links');

    if (!accountPhone || !groupLinksText.trim()) {
        alert('Please select an account and provide at least one group link.');
        return;
    }

    // Split links by new line and filter out empty lines
    const groupLinks = groupLinksText.split('\n').map(link => link.trim()).filter(link => link);
    
    // Disable form and show loading state
    startBtn.disabled = true;
    startBtn.textContent = 'Joining...';
    linksTextarea.disabled = true;
    
    try {
        const response = await fetch('/api/joiner/join_groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                account_phone: accountPhone,
                group_links: groupLinks
            }),
        });

        if (!response.ok) {
            throw new Error('Server returned an error.');
        }

        const data = await response.json();
        
        // Display results back to the user
        let resultsLog = "Joining process completed:\n\n";
        data.results.forEach(res => {
            resultsLog += `[${res.status.toUpperCase()}] ${res.link} - ${res.reason}\n`;
        });
        linksTextarea.value = resultsLog; // Show the log in the textarea
        alert('Group joining process finished! Check the text area for a detailed log.');

    } catch (error) {
        console.error('Error during group joining process:', error);
        alert('An error occurred. Please check the console for details.');
    } finally {
        // Re-enable form
        startBtn.disabled = false;
        startBtn.textContent = 'Start Joining';
        linksTextarea.disabled = false;
    }
}

// --- NEW Functions for Auto Reply Page ---

async function populateAutoReplyAccountList() {
    const accountSelect = document.getElementById('account-select');
    if (!accountSelect) return;

    try {
        const response = await fetch('/api/accounts');
        const accounts = await response.json();
        accountSelect.innerHTML = '<option value="">Select an account to configure...</option>';
        accounts.forEach(acc => {
            if (acc.status === 'Online') {
                accountSelect.innerHTML += `<option value="${acc.phone}">${acc.phone}</option>`;
            }
        });
    } catch (error) {
        console.error("Failed to fetch accounts for auto-reply:", error);
    }
}

async function fetchAutoReplySettings() {
    const accountPhone = document.getElementById('account-select').value;
    const messageTextarea = document.getElementById('auto-reply-message');
    const keywordsInput = document.getElementById('keywords');

    if (!accountPhone) {
        messageTextarea.value = '';
        keywordsInput.value = '';
        return;
    }

    try {
        const response = await fetch(`/api/settings/auto_reply/${accountPhone}`);
        const settings = await response.json();
        messageTextarea.value = settings.message || '';
        keywordsInput.value = settings.keywords || '';
    } catch (error) {
        console.error('Error fetching auto-reply settings:', error);
    }
}

async function saveAutoReplySettings() {
    const accountPhone = document.getElementById('account-select').value;
    const message = document.getElementById('auto-reply-message').value;
    const keywords = document.getElementById('keywords').value;
    const saveBtn = document.getElementById('save-settings-btn');

    if (!accountPhone) {
        alert('Please select an account first.');
        return;
    }
    if (!message.trim()) {
        alert('The reply message cannot be empty.');
        return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        const response = await fetch('/api/settings/auto_reply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                account_phone: accountPhone,
                message: message,
                keywords: keywords
            }),
        });
        if (!response.ok) throw new Error('Failed to save settings.');
        alert('Settings saved successfully! They will become active on the next server restart.');

    } catch (error) {
        console.error('Error saving settings:', error);
        alert(`Error: ${error.message}`);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Settings';
    }
}

// --- NEW Functions for Link Validator Page ---

async function validateLink() {
    const linkInput = document.getElementById('link-to-validate');
    const validateBtn = document.getElementById('validate-link-btn');
    const resultStatus = document.getElementById('result-status');
    const resultLastChecked = document.getElementById('result-last-checked');
    
    const link = linkInput.value.trim();
    if (!link) {
        alert('Please enter a link to validate.');
        return;
    }

    // Set UI to loading state
    validateBtn.disabled = true;
    validateBtn.textContent = 'Validating...';
    resultStatus.textContent = 'Checking...';
    resultStatus.className = 'text-warning';

    try {
        const response = await fetch('/api/validator/validate_link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ link: link }),
        });
        
        const data = await response.json();

        if (data.status === 'success') {
            resultStatus.textContent = data.result;
            resultStatus.className = 'text-success fw-bold';
        } else {
            resultStatus.textContent = data.result;
            resultStatus.className = 'text-danger fw-bold';
        }
        resultLastChecked.textContent = new Date().toLocaleString();

    } catch (error) {
        console.error("Error validating link:", error);
        resultStatus.textContent = "Failed to communicate with server.";
        resultStatus.className = 'text-danger fw-bold';
    } finally {
        // Restore button state
        validateBtn.disabled = false;
        validateBtn.textContent = 'Validate Link';
    }
}
// --- NEW Functions for Link Extractor Page ---

async function populateExtractorAccountList() {
    // This is the same as the other account list functions
    const accountSelect = document.getElementById('account-select');
    if (!accountSelect) return;
    try {
        const response = await fetch('/api/accounts');
        const accounts = await response.json();
        accountSelect.innerHTML = '<option value="">Select an account...</option>';
        accounts.forEach(acc => {
            if (acc.status === 'Online') {
                accountSelect.innerHTML += `<option value="${acc.phone}">${acc.phone}</option>`;
            }
        });
    } catch (error) { console.error("Failed to fetch accounts for extractor:", error); }
}

async function startExtractionProcess() {
    const startBtn = document.getElementById('start-extraction-btn');
    const resultsArea = document.getElementById('extracted-data');
    const copyBtn = document.getElementById('copy-all-btn');
    const downloadBtn = document.getElementById('download-csv-btn');

    const request = {
        account_phone: document.getElementById('account-select').value,
        channel_link: document.getElementById('source-channel-link').value,
        extract_type: document.querySelector('input[name="extract-type"]:checked').value,
        limit: parseInt(document.getElementById('limit').value, 10),
    };

    if (!request.account_phone || !request.channel_link) {
        alert('Please select an account and provide a source link.');
        return;
    }

    startBtn.disabled = true;
    startBtn.textContent = 'Extracting...';
    resultsArea.value = 'Scanning messages, this may take a moment...';
    copyBtn.disabled = true;
    downloadBtn.disabled = true;

    try {
        const response = await fetch('/api/extractor/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
        });
        const result = await response.json();

        if (result.status === 'success') {
            resultsArea.value = result.data.join('\n');
            if (result.data.length > 0) {
                copyBtn.disabled = false;
                downloadBtn.disabled = false;
            }
        } else {
            resultsArea.value = `Error: ${result.data}`;
        }

    } catch (error) {
        console.error('Extraction error:', error);
        resultsArea.value = 'An error occurred while communicating with the server.';
    } finally {
        startBtn.disabled = false;
        startBtn.textContent = 'Start Extraction';
    }
}

function copyExtractedData() {
    const resultsArea = document.getElementById('extracted-data');
    navigator.clipboard.writeText(resultsArea.value).then(() => {
        alert('Copied to clipboard!');
    }, () => {
        alert('Failed to copy.');
    });
}

function downloadExtractedDataAsCSV() {
    const resultsArea = document.getElementById('extracted-data');
    const data = resultsArea.value.split('\n').map(item => [item]); // Wrap each item in an array for CSV row
    let csvContent = "data:text/csv;charset=utf-8," 
        + "Extracted Data\n" // Header
        + data.map(e => e.join(",")).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "extracted_data.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// --- NEW Functions for Forward Config Page ---

async function populateForwardConfigAccountList() {
    // This is the same as the other account list functions
    const accountSelect = document.getElementById('account-select');
    if (!accountSelect) return;
    try {
        const response = await fetch('/api/accounts');
        const accounts = await response.json();
        accountSelect.innerHTML = '<option value="">Select an account...</option>';
        accounts.forEach(acc => {
            if (acc.status === 'Online') {
                accountSelect.innerHTML += `<option value="${acc.phone}">${acc.phone}</option>`;
            }
        });
    } catch (error) { console.error("Failed to fetch accounts for forwarder:", error); }
}

async function startForwardingJob() {
    const startBtn = document.getElementById('start-forwarding-btn');
    
    const targets = document.getElementById('target-groups').value
        .split('\n')
        .map(t => t.trim())
        .filter(t => t);
    
    const request = {
        account_phone: document.getElementById('account-select').value,
        message_link: document.getElementById('message-link').value,
        delay: parseInt(document.getElementById('delay').value, 10),
        cycle_delay: parseInt(document.getElementById('cycle-delay').value, 10),
        targets: targets,
        hide_sender: document.getElementById('hide-sender').checked,
    };

    if (!request.account_phone || !request.message_link || targets.length === 0) {
        alert('Please select an account, provide a message link, and add at least one target.');
        return;
    }

    startBtn.disabled = true;
    startBtn.textContent = 'Job Started...';

    try {
        const response = await fetch('/api/forwarder/start_forwarding', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
        });
        const result = await response.json();

        if (result.status === 'success') {
            alert('Forwarding job started in the background! Check the server console for progress.');
        } else {
            throw new Error(result.message || 'Failed to start job.');
        }

    } catch (error) {
        console.error('Forwarding job error:', error);
        alert(`Error: ${error.message}`);
    } finally {
        // We can re-enable the button to allow starting another job
        startBtn.disabled = false;
        startBtn.textContent = 'Start Forwarding';
    }
}

// --- NEW Functions for Smart Selling Page ---

async function populateSmartSellingAccountList() {
    const accountSelect = document.getElementById('account-select');
    if (!accountSelect) return;
    try {
        const response = await fetch('/api/accounts');
        const accounts = await response.json();
        accountSelect.innerHTML = '<option value="">Select an account to configure...</option>';
        accounts.forEach(acc => {
            if (acc.status === 'Online') {
                accountSelect.innerHTML += `<option value="${acc.phone}">${acc.phone}</option>`;
            }
        });
    } catch (error) { console.error("Failed to fetch accounts for smart selling:", error); }
}

async function fetchSmartSellingConfig() {
    const accountPhone = document.getElementById('account-select').value;
    const enableSwitch = document.getElementById('enable-config');
    const mustContainInput = document.getElementById('must-contain');
    const maybeContainInput = document.getElementById('maybe-contain');
    const messageTextarea = document.getElementById('auto-reply-message');

    if (!accountPhone) {
        enableSwitch.checked = false;
        mustContainInput.value = '';
        maybeContainInput.value = '';
        messageTextarea.value = '';
        return;
    }

    try {
        const response = await fetch(`/api/settings/smart_selling/${accountPhone}`);
        const settings = await response.json();
        enableSwitch.checked = settings.enabled || false;
        mustContainInput.value = settings.must_contain || '';
        maybeContainInput.value = settings.maybe_contain || '';
        messageTextarea.value = settings.message || '';
    } catch (error) {
        console.error('Error fetching smart selling settings:', error);
    }
}

async function saveSmartSellingConfig() {
    const saveBtn = document.getElementById('save-config-btn');
    const settings = {
        account_phone: document.getElementById('account-select').value,
        enabled: document.getElementById('enable-config').checked,
        must_contain: document.getElementById('must-contain').value,
        maybe_contain: document.getElementById('maybe-contain').value,
        message: document.getElementById('auto-reply-message').value,
    };

    if (!settings.account_phone) {
        alert('Please select an account first.');
        return;
    }
    if (settings.enabled && !settings.message.trim()) {
        alert('The reply message cannot be empty when the feature is enabled.');
        return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        const response = await fetch('/api/settings/smart_selling', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings),
        });
        if (!response.ok) throw new Error('Failed to save configuration.');
        alert('Configuration saved successfully! It will become active on the next server restart.');

    } catch (error) {
        console.error('Error saving config:', error);
        alert(`Error: ${error.message}`);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Configuration';
    }
}
function connectLogWebSocket() {
    const logContent = document.getElementById('log-content');
    if (!logContent) return;

    const ws = new WebSocket(`ws://${window.location.host}/ws/logs`);

    ws.onopen = () => {
        logContent.textContent = "[INFO] Connected to live logs...\n";
    };

    ws.onmessage = (event) => {
        // Append the new log message and scroll to the bottom
        logContent.textContent += `${event.data}\n`;
        logContent.scrollTop = logContent.scrollHeight;
    };

    ws.onerror = (error) => {
        console.error("Log WebSocket error:", error);
        logContent.textContent += "[ERROR] Connection to log stream lost.\n";
    };

    ws.onclose = () => {
        console.log("Log WebSocket closed. Reconnecting in 5 seconds...");
        logContent.textContent += "[INFO] Disconnected. Attempting to reconnect in 5 seconds...\n";
        // Simple auto-reconnect logic
        setTimeout(connectLogWebSocket, 5000);
    };
}

async function handleLogout() {
    // This will pop up a confirmation box in the browser
    if (confirm("Are you sure you want to log out?")) {
        try {
            await fetch('/api/logout', { method: 'POST' });
            authManager.clearAuth();
             // Clear the stored token
            sessionStorage.removeItem('authToken');
            window.location.href = 'login.html';
        } catch (error) {
            console.error("Logout failed:", error);
            alert("Could not log out. Please check your connection.");
        }
    }
}
// In frontend/script.js
// In frontend/script.js
async function fetchAdminUsers() {
    try {
        const response = await fetch('/api/admin/users');
        if (!response.ok) {
            alert('You do not have permission to view this page.');
            window.location.href = 'index.html';
            return;
        }
        const users = await response.json();
        const tableBody = document.getElementById('users-table-body');
        tableBody.innerHTML = '';
        
        users.forEach(user => {
            const roleBadge = user.role === 'admin'
                ? '<span class="badge text-bg-primary">Admin</span>'
                : '<span class="badge text-bg-secondary">User</span>';
            
            const row = `
                <tr>
                    <td><strong>${user.username}</strong></td>
                    <td>${roleBadge}</td>
                    <td>${user.plan_id || 'N/A'}</td>
                    <td>${user.subscription_end_date || 'N/A'}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-light btn-icon" title="Grant/Edit Subscription">
                            <i class="fa-solid fa-rocket"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger btn-icon" title="Delete User">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
            tableBody.innerHTML += row;
        });
    } catch (error) {
        console.error("Failed to fetch admin user list:", error);
    }
}
// --- Admin Panel - Manage Plans ---
async function fetchAdminPlans() {
    const response = await fetch('/api/plans'); // Uses the public endpoint, which is fine
    const plans = await response.json();
    const tableBody = document.getElementById('plans-table-body');
    tableBody.innerHTML = '';
    plans.forEach(plan => {
        const row = `
            <tr>
                <td>${plan.id}</td>
                <td>${plan.name}</td>
                <td>$${plan.price.toFixed(2)}</td>
                <td>${plan.duration_days}</td>
                <td>
                    <button class="btn btn-sm btn-primary edit-plan-btn" data-id="${plan.id}" data-name="${plan.name}" data-price="${plan.price}" data-duration="${plan.duration_days}">Edit</button>
                </td>
            </tr>
        `;
        tableBody.innerHTML += row;
    });
}

function initializePlanModal() {
    const planModalElement = document.getElementById('planModal');
    const planModal = new bootstrap.Modal(planModalElement);
    
    document.getElementById('add-plan-btn').addEventListener('click', () => {
        document.getElementById('plan-form').reset();
        document.getElementById('plan-id').value = '';
        document.getElementById('planModalLabel').textContent = 'Add New Plan';
        planModal.show();
    });

    document.getElementById('plans-table-body').addEventListener('click', (event) => {
        if (event.target.classList.contains('edit-plan-btn')) {
            const btn = event.target;
            document.getElementById('plan-id').value = btn.dataset.id;
            document.getElementById('plan-name').value = btn.dataset.name;
            document.getElementById('plan-price').value = btn.dataset.price;
            document.getElementById('plan-duration').value = btn.dataset.duration;
            document.getElementById('planModalLabel').textContent = `Edit Plan #${btn.dataset.id}`;
            planModal.show();
        }
    });

    document.getElementById('save-plan-btn').addEventListener('click', async () => {
        const planId = document.getElementById('plan-id').value;
        const plan = {
            name: document.getElementById('plan-name').value,
            price: parseFloat(document.getElementById('plan-price').value),
            duration_days: parseInt(document.getElementById('plan-duration').value),
        };
        
        const isEditing = !!planId;
        const url = isEditing ? `/api/admin/plans/${planId}` : '/api/admin/plans';
        const method = isEditing ? 'PUT' : 'POST';

        await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(plan),
        });
        
        planModal.hide();
        await fetchAdminPlans();
    });
}// --- Admin dashboard stats ---
async function fetchAdminDashboardStats() {
    console.log("Fetching admin dashboard stats...");

    try {
        const users = await authFetch('/api/admin/users');

        const totalUsersCard = document.getElementById('total-users-card');
        if (totalUsersCard) totalUsersCard.textContent = users.length;

        const activeSubsCard = document.getElementById('active-subs-card');
        if (activeSubsCard) {
            const now = new Date();
            const activeSubs = users.filter(user =>
                user.subscription_end_date && new Date(user.subscription_end_date) > now
            ).length;
            activeSubsCard.textContent = activeSubs;
        }

        console.log("Admin dashboard stats updated successfully.");
    } catch (error) {
        console.error("Failed to fetch admin dashboard stats:", error);
    }
}
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    console.log(value)
    if (parts.length === 2) return parts.pop().split(';').shift();
}
