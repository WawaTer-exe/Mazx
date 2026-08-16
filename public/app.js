const state = {
    user: null,
    usage: 0,
    limit: 0,
    authMode: "login",
    conversations: [],
    currentConversation: null,
    loading: false
};

/* =========================
   ELEMENTS
========================= */

const $ = (id) => document.getElementById(id);

const authScreen = $("authScreen");
const chatScreen = $("chatScreen");

const authForm = $("authForm");
const usernameInput = $("usernameInput");
const emailInput = $("emailInput");
const passwordInput = $("passwordInput");
const authError = $("authError");

const messages = $("messages");
const chatForm = $("chatForm");
const promptInput = $("promptInput");

const chatList = $("chatList");
const accountInfo = $("accountInfo");
const planBadge = $("planBadge");
const usageInfo = $("usageInfo");

const newChatButton = $("newChat");
const logoutButton = $("logoutButton");
const adminButton = $("adminButton");

const adminModal = $("adminModal");
const closeAdmin = $("closeAdmin");
const adminStats = $("adminStats");
const adminUsers = $("adminUsers");

const devAdminModal = $("devAdminModal");
const closeDevAdmin = $("closeDevAdmin");
const devAdminForm = $("devAdminForm");
const devAdminPassword = $("devAdminPassword");
const devAdminError = $("devAdminError");

/* =========================
   API HELPER
========================= */

async function api(path, options = {}) {
    const response = await fetch(path, {
        credentials: "include",
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    let data = {};

    try {
        data = await response.json();
    } catch {
        data = {};
    }

    if (!response.ok) {
        throw new Error(
            data.error ||
            `Request failed (${response.status})`
        );
    }

    return data;
}

/* =========================
   AUTH MODE
========================= */

function setAuthMode(mode) {
    state.authMode = mode;

    document
        .querySelectorAll(".auth-tab")
        .forEach(button => {
            button.classList.toggle(
                "active",
                button.dataset.mode === mode
            );
        });

    if (mode === "signup") {
        emailInput.classList.remove("hidden");
        emailInput.required = true;

        usernameInput.placeholder =
            "Username";

        passwordInput.autocomplete =
            "new-password";
    } else {
        emailInput.classList.add("hidden");
        emailInput.required = false;

        usernameInput.placeholder =
            "Username or email";

        passwordInput.autocomplete =
            "current-password";
    }

    authError.textContent = "";
}

/* =========================
   AUTH SUBMIT
========================= */

authForm.addEventListener(
    "submit",
    async event => {

        event.preventDefault();

        authError.textContent = "";

        const username =
            usernameInput.value.trim();

        const password =
            passwordInput.value;

        if (!username || !password) {
            authError.textContent =
                "Please fill in all required fields.";

            return;
        }

        try {

            if (state.authMode === "signup") {

                const email =
                    emailInput.value
                        .trim()
                        .toLowerCase();

                if (!email) {
                    authError.textContent =
                        "Enter your email.";

                    return;
                }

                await api(
                    "/api/auth/signup",
                    {
                        method: "POST",
                        body: JSON.stringify({
                            username,
                            email,
                            password
                        })
                    }
                );

            } else {

                await api(
                    "/api/auth/login",
                    {
                        method: "POST",
                        body: JSON.stringify({
                            username,
                            password
                        })
                    }
                );
            }

            authForm.reset();

            await loadUser();

        } catch (error) {

            authError.textContent =
                error.message;
        }
    }
);

/* =========================
   AUTH TABS
========================= */

document
    .querySelectorAll(".auth-tab")
    .forEach(button => {

        button.addEventListener(
            "click",
            () => {
                setAuthMode(
                    button.dataset.mode
                );
            }
        );

    });

/* =========================
   LOAD USER
========================= */

async function loadUser() {

    try {

        const data =
            await api("/api/me");

        state.user =
            data.user;

        state.usage =
            data.usage || 0;

        if (!state.user) {
            showLoggedOut();
            return;
        }

        state.limit =
            state.user.plan === "pro"
                ? 200
                : 20;

        showLoggedIn();

        await loadConversations();

    } catch (error) {

        console.error(error);

        showLoggedOut();
    }
}

/* =========================
   LOGGED OUT
========================= */

function showLoggedOut() {

    state.user = null;

    authScreen.classList.remove(
        "hidden"
    );

    chatScreen.classList.add(
        "hidden"
    );

    logoutButton.classList.add(
        "hidden"
    );

    adminButton.classList.add(
        "hidden"
    );

    accountInfo.textContent =
        "Not signed in";

    planBadge.textContent =
        "FREE";

    usageInfo.textContent =
        "Not signed in";

    chatList.innerHTML = "";
}

/* =========================
   LOGGED IN
========================= */

function showLoggedIn() {

    authScreen.classList.add(
        "hidden"
    );

    chatScreen.classList.remove(
        "hidden"
    );

    logoutButton.classList.remove(
        "hidden"
    );

    accountInfo.textContent =
        `${state.user.username}`;

    planBadge.textContent =
        state.user.plan
            .toUpperCase();

    state.limit =
        state.user.plan === "pro"
            ? 200
            : 20;

    updateUsage();

    if (state.user.is_admin) {
        adminButton.classList.remove(
            "hidden"
        );
    } else {
        adminButton.classList.add(
            "hidden"
        );
    }
}

/* =========================
   USAGE
========================= */

function updateUsage() {

    usageInfo.textContent =
        `${state.usage} / ${state.limit} requests today`;

}

/* =========================
   LOGOUT
========================= */

logoutButton.addEventListener(
    "click",
    async () => {

        try {

            await api(
                "/api/auth/logout",
                {
                    method: "POST"
                }
            );

        } catch (error) {

            console.error(error);
        }

        state.user = null;
        state.conversations = [];
        state.currentConversation = null;

        messages.innerHTML = "";

        showLoggedOut();
    }
);

/* =========================
   CONVERSATIONS
========================= */

async function loadConversations() {

    try {

        const data =
            await api(
                "/api/conversations"
            );

        state.conversations =
            data.conversations || [];

        renderConversations();

    } catch (error) {

        console.error(error);
    }
}

function renderConversations() {

    chatList.innerHTML = "";

    for (
        const conversation
        of state.conversations
    ) {

        const button =
            document.createElement(
                "button"
            );

        button.className =
            "chat-item";

        if (
            state.currentConversation ===
            conversation.id
        ) {
            button.classList.add(
                "active"
            );
        }

        button.textContent =
            conversation.title;

        button.addEventListener(
            "click",
            () => {

                state.currentConversation =
                    conversation.id;

                renderConversations();

                /*
                 * Conversation message loading
                 * can be added when the message
                 * history endpoint is added.
                 */

                messages.innerHTML = "";

                addMessage(
                    "assistant",
                    `Conversation "${conversation.title}" selected.`
                );
            }
        );

        chatList.appendChild(
            button
        );
    }
}

/* =========================
   NEW CHAT
========================= */

newChatButton.addEventListener(
    "click",
    async () => {

        try {

            const data =
                await api(
                    "/api/conversations",
                    {
                        method: "POST",
                        body: JSON.stringify({
                            title:
                                "New chat"
                        })
                    }
                );

            state.currentConversation =
                data.id;

            messages.innerHTML = "";

            renderWelcome();

            await loadConversations();

        } catch (error) {

            alert(error.message);
        }
    }
);

/* =========================
   WELCOME
========================= */

function renderWelcome() {

    messages.innerHTML = `
        <div class="welcome">

            <div class="welcome-logo">
                M
            </div>

            <h2>
                What are you building?
            </h2>

            <p>
                Ask Mazx to write code,
                debug an error, explain
                a project, or improve
                your software.
            </p>

            <div class="suggestions">

                <button
                    class="suggestion"
                    data-prompt="Build me a Python Discord bot"
                >
                    Build a Discord bot
                </button>

                <button
                    class="suggestion"
                    data-prompt="Explain this JavaScript code"
                >
                    Explain my code
                </button>

                <button
                    class="suggestion"
                    data-prompt="Help me debug my Python program"
                >
                    Debug my program
                </button>

            </div>

        </div>
    `;

    attachSuggestionHandlers();
}

/* =========================
   SUGGESTIONS
========================= */

function attachSuggestionHandlers() {

    document
        .querySelectorAll(
            ".suggestion"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    promptInput.value =
                        button.dataset.prompt;

                    promptInput.focus();
                }
            );

        });
}

attachSuggestionHandlers();

/* =========================
   MESSAGE RENDERING
========================= */

function addMessage(
    role,
    content
) {

    const wrapper =
        document.createElement(
            "div"
        );

    wrapper.className =
        `message ${role}`;

    const roleLabel =
        document.createElement(
            "div"
        );

    roleLabel.className =
        "message-role";

    roleLabel.textContent =
        role === "user"
            ? "YOU"
            : "MAZX";

    const messageContent =
        document.createElement(
            "div"
        );

    messageContent.className =
        "message-content";

    messageContent.textContent =
        content;

    wrapper.appendChild(
        roleLabel
    );

    wrapper.appendChild(
        messageContent
    );

    messages.appendChild(
        wrapper
    );

    messages.scrollTop =
        messages.scrollHeight;

    return wrapper;
}

/* =========================
   CHAT
========================= */

chatForm.addEventListener(
    "submit",
    async event => {

        event.preventDefault();

        if (state.loading) {
            return;
        }

        const message =
            promptInput.value.trim();

        if (!message) {
            return;
        }

        if (!state.user) {
            return;
        }

        if (
            state.usage >=
            state.limit
        ) {

            addMessage(
                "assistant",
                `You've reached your ${state.user.plan} daily limit.`
            );

            return;
        }

        state.loading = true;

        promptInput.value = "";

        addMessage(
            "user",
            message
        );

        const loadingMessage =
            addMessage(
                "assistant",
                "Mazx is thinking..."
            );

        try {

            const data =
                await api(
                    "/api/chat",
                    {
                        method: "POST",
                        body: JSON.stringify({
                            message
                        })
                    }
                );

            loadingMessage
                .querySelector(
                    ".message-content"
                )
                .textContent =
                    data.response ||
                    "Mazx returned no response.";

            state.usage =
                data.usage ||
                state.usage + 1;

            if (data.limit) {
                state.limit =
                    data.limit;
            }

            updateUsage();

        } catch (error) {

            loadingMessage
                .querySelector(
                    ".message-content"
                )
                .textContent =
                    `Error: ${error.message}`;

        } finally {

            state.loading = false;
        }
    }
);

/* =========================
   ENTER TO SEND
========================= */

promptInput.addEventListener(
    "keydown",
    event => {

        if (
            event.key === "Enter" &&
            !event.shiftKey
        ) {

            event.preventDefault();

            chatForm.requestSubmit();
        }
    }
);

/* =========================
   ADMIN PANEL
========================= */

adminButton.addEventListener(
    "click",
    async () => {

        adminModal.classList.remove(
            "hidden"
        );

        await loadAdminPanel();
    }
);

closeAdmin.addEventListener(
    "click",
    () => {

        adminModal.classList.add(
            "hidden"
        );
    }
);

async function loadAdminPanel() {

    adminStats.innerHTML =
        "Loading...";

    adminUsers.innerHTML =
        "Loading...";

    try {

        const stats =
            await api(
                "/api/admin/stats"
            );

        adminStats.innerHTML = `
            <div class="stat">
                <div class="stat-label">
                    USERS
                </div>
                <div class="stat-value">
                    ${stats.users}
                </div>
            </div>

            <div class="stat">
                <div class="stat-label">
                    PRO USERS
                </div>
                <div class="stat-value">
                    ${stats.pro}
                </div>
            </div>

            <div class="stat">
                <div class="stat-label">
                    ADMINS
                </div>
                <div class="stat-value">
                    ${stats.admins}
                </div>
            </div>
        `;

        const data =
            await api(
                "/api/admin/users"
            );

        renderAdminUsers(
            data.users || []
        );

    } catch (error) {

        adminStats.innerHTML = "";

        adminUsers.innerHTML =
            `<div class="error-message">
                ${escapeHtml(error.message)}
            </div>`;
    }
}

/* =========================
   ADMIN USERS
========================= */

function renderAdminUsers(users) {

    adminUsers.innerHTML = "";

    if (!users.length) {

        adminUsers.textContent =
            "No users found.";

        return;
    }

    for (
        const user
        of users
    ) {

        const row =
            document.createElement(
                "div"
            );

        row.className =
            "admin-user";

        const info =
            document.createElement(
                "div"
            );

        info.className =
            "admin-user-info";

        info.innerHTML = `
            <div class="admin-user-name">
                ${escapeHtml(user.username)}
            </div>

            <div class="admin-user-email">
                ${escapeHtml(user.email)}
            </div>
        `;

        const actions =
            document.createElement(
                "div"
            );

        actions.className =
            "admin-user-actions";

        const freeButton =
            document.createElement(
                "button"
            );

        freeButton.textContent =
            "Free";

        const proButton =
            document.createElement(
                "button"
            );

        proButton.textContent =
            "Pro";

        freeButton.addEventListener(
            "click",
            () =>
                changeUserPlan(
                    user.id,
                    "free"
                )
        );

        proButton.addEventListener(
            "click",
            () =>
                changeUserPlan(
                    user.id,
                    "pro"
                )
        );

        actions.appendChild(
            freeButton
        );

        actions.appendChild(
            proButton
        );

        row.appendChild(
            info
        );

        row.appendChild(
            actions
        );

        adminUsers.appendChild(
            row
        );
    }
}

/* =========================
   CHANGE PLAN
========================= */

async function changeUserPlan(
    userId,
    plan
) {

    try {

        await api(
            "/api/admin/users/plan",
            {
                method: "POST",
                body: JSON.stringify({
                    id: userId,
                    plan
                })
            }
        );

        await loadAdminPanel();

        /*
         * Refresh our own account if
         * the admin changed themselves.
         */

        await loadUser();

    } catch (error) {

        alert(error.message);
    }
}

/* =========================
   DEVELOPMENT ADMIN
========================= */

function openDevAdmin() {

    if (!devAdminModal) {
        return;
    }

    devAdminModal.classList.remove(
        "hidden"
    );

    devAdminPassword.focus();
}

function closeDevAdminModal() {

    devAdminModal.classList.add(
        "hidden"
    );

    devAdminPassword.value = "";

    devAdminError.textContent = "";
}

closeDevAdmin.addEventListener(
    "click",
    closeDevAdminModal
);

devAdminForm.addEventListener(
    "submit",
    async event => {

        event.preventDefault();

        devAdminError.textContent =
            "";

        try {

            await api(
                "/api/dev/admin",
                {
                    method: "POST",
                    body: JSON.stringify({
                        password:
                            devAdminPassword.value
                    })
                }
            );

            closeDevAdminModal();

            await loadUser();

            if (
                state.user &&
                state.user.is_admin
            ) {
                adminModal.classList.remove(
                    "hidden"
                );

                await loadAdminPanel();
            }

        } catch (error) {

            devAdminError.textContent =
                error.message;
        }
    }
);

/*
 * Press Ctrl + Shift + A to open
 * the development admin unlock.
 *
 * This is only useful while DEV_MODE
 * is enabled on the Cloudflare Worker.
 */

document.addEventListener(
    "keydown",
    event => {

        if (
            event.ctrlKey &&
            event.shiftKey &&
            event.key.toLowerCase() === "a"
        ) {

            event.preventDefault();

            openDevAdmin();
        }
    }
);

/* =========================
   HTML ESCAPING
========================= */

function escapeHtml(value) {

    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/* =========================
   INITIALIZATION
========================= */

setAuthMode("login");

loadUser();
