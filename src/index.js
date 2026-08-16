const COOKIE_NAME = "mazx_session";

const FREE_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const PRO_MODEL = "@cf/meta/llama-3.1-8b-instruct";

/* -----------------------------
   Basic helpers
----------------------------- */

function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...headers
        }
    });
}

function cors(request) {
    const origin = request.headers.get("Origin");

    return {
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
    };
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

/* -----------------------------
   Base64 helpers
----------------------------- */

function base64UrlEncode(bytes) {
    let binary = "";

    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function base64UrlDecode(value) {
    value = value
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    while (value.length % 4) {
        value += "=";
    }

    const binary = atob(value);

    return Uint8Array.from(
        binary,
        character => character.charCodeAt(0)
    );
}

function textEncoder(value) {
    return new TextEncoder().encode(value);
}

/* -----------------------------
   HMAC session signing
----------------------------- */

async function createHmac(secret, value) {
    const key = await crypto.subtle.importKey(
        "raw",
        textEncoder(secret),
        {
            name: "HMAC",
            hash: "SHA-256"
        },
        false,
        ["sign"]
    );

    return new Uint8Array(
        await crypto.subtle.sign(
            "HMAC",
            key,
            textEncoder(value)
        )
    );
}

async function signSession(payload, secret) {
    const body = base64UrlEncode(
        textEncoder(JSON.stringify(payload))
    );

    const signature = await createHmac(secret, body);

    return `${body}.${base64UrlEncode(signature)}`;
}

async function verifySession(token, secret) {
    try {
        const parts = token.split(".");

        if (parts.length !== 2) {
            return null;
        }

        const body = parts[0];
        const signature = parts[1];

        const key = await crypto.subtle.importKey(
            "raw",
            textEncoder(secret),
            {
                name: "HMAC",
                hash: "SHA-256"
            },
            false,
            ["verify"]
        );

        const valid = await crypto.subtle.verify(
            "HMAC",
            key,
            base64UrlDecode(signature),
            textEncoder(body)
        );

        if (!valid) {
            return null;
        }

        const payload = JSON.parse(
            new TextDecoder().decode(
                base64UrlDecode(body)
            )
        );

        if (
            !payload.exp ||
            payload.exp < Math.floor(Date.now() / 1000)
        ) {
            return null;
        }

        return payload;

    } catch {
        return null;
    }
}

/* -----------------------------
   Password hashing
----------------------------- */

async function hashPassword(password) {
    const salt = crypto.getRandomValues(
        new Uint8Array(16)
    );

    const key = await crypto.subtle.importKey(
        "raw",
        textEncoder(password),
        "PBKDF2",
        false,
        ["deriveBits"]
    );

    const bits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt,
            iterations: 120000,
            hash: "SHA-256"
        },
        key,
        256
    );

    return [
        base64UrlEncode(salt),
        base64UrlEncode(new Uint8Array(bits))
    ].join(".");
}

async function verifyPassword(password, storedHash) {
    try {
        const [saltString, hashString] =
            storedHash.split(".");

        const salt = base64UrlDecode(saltString);

        const key = await crypto.subtle.importKey(
            "raw",
            textEncoder(password),
            "PBKDF2",
            false,
            ["deriveBits"]
        );

        const bits = await crypto.subtle.deriveBits(
            {
                name: "PBKDF2",
                salt,
                iterations: 120000,
                hash: "SHA-256"
            },
            key,
            256
        );

        const expected = base64UrlDecode(hashString);
        const actual = new Uint8Array(bits);

        if (expected.length !== actual.length) {
            return false;
        }

        let difference = 0;

        for (let i = 0; i < expected.length; i++) {
            difference |= expected[i] ^ actual[i];
        }

        return difference === 0;

    } catch {
        return false;
    }
}

/* -----------------------------
   Cookies
----------------------------- */

function getCookies(request) {
    const cookies = {};

    const header = request.headers.get("Cookie") || "";

    for (const part of header.split(";")) {
        const index = part.indexOf("=");

        if (index === -1) {
            continue;
        }

        const name = part
            .slice(0, index)
            .trim();

        const value = part
            .slice(index + 1)
            .trim();

        cookies[name] = decodeURIComponent(value);
    }

    return cookies;
}

function createSessionCookie(token) {
    return [
        `${COOKIE_NAME}=${encodeURIComponent(token)}`,
        "Max-Age=604800",
        "Path=/",
        "HttpOnly",
        "Secure",
        "SameSite=Lax"
    ].join("; ");
}

/* -----------------------------
   Authentication
----------------------------- */

async function getCurrentUser(request, env) {
    const cookies = getCookies(request);

    const token = cookies[COOKIE_NAME];

    if (!token) {
        return null;
    }

    const session = await verifySession(
        token,
        env.SESSION_SECRET
    );

    if (!session || !session.userId) {
        return null;
    }

    return await env.DB.prepare(`
        SELECT
            id,
            username,
            email,
            plan,
            is_admin,
            created_at
        FROM users
        WHERE id = ?
    `)
        .bind(session.userId)
        .first();
}

async function createUserSession(user, env) {
    const payload = {
        userId: user.id,
        exp: Math.floor(Date.now() / 1000) + 604800
    };

    return await signSession(
        payload,
        env.SESSION_SECRET
    );
}

async function requireUser(request, env) {
    const user = await getCurrentUser(request, env);

    if (!user) {
        throw new Response(
            JSON.stringify({
                error: "You must be logged in."
            }),
            {
                status: 401,
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );
    }

    return user;
}

async function requireAdmin(request, env) {
    const user = await requireUser(
        request,
        env
    );

    if (!user.is_admin) {
        throw new Response(
            JSON.stringify({
                error: "Administrator access required."
            }),
            {
                status: 403,
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );
    }

    return user;
}

/* -----------------------------
   Usage tracking
----------------------------- */

async function getUsage(userId, env) {
    const row = await env.DB.prepare(`
        SELECT requests
        FROM usage
        WHERE user_id = ?
        AND day = ?
    `)
        .bind(userId, today())
        .first();

    return row?.requests || 0;
}

async function incrementUsage(userId, env) {
    await env.DB.prepare(`
        INSERT INTO usage (
            user_id,
            day,
            requests
        )
        VALUES (?, ?, 1)

        ON CONFLICT(user_id, day)
        DO UPDATE SET
            requests = requests + 1
    `)
        .bind(userId, today())
        .run();
}

/* -----------------------------
   API
----------------------------- */

async function handleAPI(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    if (method === "OPTIONS") {
        return new Response(
            null,
            {
                headers: cors(request)
            }
        );
    }

    /* Health check */

    if (
        url.pathname === "/api/health" &&
        method === "GET"
    ) {
        return json(
            {
                ok: true,
                service: "Mazx"
            },
            200,
            cors(request)
        );
    }

    /* -------------------------
       SIGN UP
    ------------------------- */

    if (
        url.pathname === "/api/auth/signup" &&
        method === "POST"
    ) {
        const body = await request.json();

        const username =
            String(body.username || "").trim();

        const email =
            String(body.email || "")
                .trim()
                .toLowerCase();

        const password =
            String(body.password || "");

        if (
            !/^[a-zA-Z0-9_]{3,24}$/.test(username)
        ) {
            return json(
                {
                    error:
                        "Username must be 3-24 characters."
                },
                400,
                cors(request)
            );
        }

        if (
            !email.includes("@") ||
            email.length > 160
        ) {
            return json(
                {
                    error: "Enter a valid email."
                },
                400,
                cors(request)
            );
        }

        if (password.length < 8) {
            return json(
                {
                    error:
                        "Password must be at least 8 characters."
                },
                400,
                cors(request)
            );
        }

        const existing =
            await env.DB.prepare(`
                SELECT id
                FROM users
                WHERE username = ?
                OR email = ?
            `)
                .bind(username, email)
                .first();

        if (existing) {
            return json(
                {
                    error:
                        "Username or email already exists."
                },
                409,
                cors(request)
            );
        }

        const passwordHash =
            await hashPassword(password);

        const result =
            await env.DB.prepare(`
                INSERT INTO users (
                    username,
                    email,
                    password_hash
                )
                VALUES (?, ?, ?)
            `)
                .bind(
                    username,
                    email,
                    passwordHash
                )
                .run();

        const user =
            await env.DB.prepare(`
                SELECT
                    id,
                    username,
                    email,
                    plan,
                    is_admin,
                    created_at
                FROM users
                WHERE id = ?
            `)
                .bind(result.meta.last_row_id)
                .first();

        const session =
            await createUserSession(
                user,
                env
            );

        return json(
            {
                user
            },
            201,
            {
                ...cors(request),
                "Set-Cookie":
                    createSessionCookie(session)
            }
        );
    }

    /* -------------------------
       LOGIN
    ------------------------- */

    if (
        url.pathname === "/api/auth/login" &&
        method === "POST"
    ) {
        const body = await request.json();

        const username =
            String(body.username || "").trim();

        const password =
            String(body.password || "");

        const user =
            await env.DB.prepare(`
                SELECT *
                FROM users
                WHERE username = ?
                OR email = ?
            `)
                .bind(
                    username,
                    username.toLowerCase()
                )
                .first();

        if (
            !user ||
            !(await verifyPassword(
                password,
                user.password_hash
            ))
        ) {
            return json(
                {
                    error:
                        "Invalid username/email or password."
                },
                401,
                cors(request)
            );
        }

        const safeUser = {
            id: user.id,
            username: user.username,
            email: user.email,
            plan: user.plan,
            is_admin: user.is_admin,
            created_at: user.created_at
        };

        const session =
            await createUserSession(
                safeUser,
                env
            );

        return json(
            {
                user: safeUser
            },
            200,
            {
                ...cors(request),
                "Set-Cookie":
                    createSessionCookie(session)
            }
        );
    }

    /* -------------------------
       LOGOUT
    ------------------------- */

    if (
        url.pathname === "/api/auth/logout" &&
        method === "POST"
    ) {
        return json(
            {
                ok: true
            },
            200,
            {
                ...cors(request),
                "Set-Cookie":
                    `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`
            }
        );
    }

    /* -------------------------
       CURRENT USER
    ------------------------- */

    if (
        url.pathname === "/api/me" &&
        method === "GET"
    ) {
        const user =
            await getCurrentUser(
                request,
                env
            );

        if (!user) {
            return json(
                {
                    user: null
                },
                200,
                cors(request)
            );
        }

        return json(
            {
                user,
                usage:
                    await getUsage(
                        user.id,
                        env
                    )
            },
            200,
            cors(request)
        );
    }

    /* -------------------------
       AI CHAT
    ------------------------- */

    if (
        url.pathname === "/api/chat" &&
        method === "POST"
    ) {
        const user =
            await requireUser(
                request,
                env
            );

        const freeLimit =
            Number(
                env.FREE_DAILY_LIMIT || 20
            );

        const proLimit =
            Number(
                env.PRO_DAILY_LIMIT || 200
            );

        const limit =
            user.plan === "pro"
                ? proLimit
                : freeLimit;

        const used =
            await getUsage(
                user.id,
                env
            );

        if (used >= limit) {
            return json(
                {
                    error:
                        `You have reached your ${user.plan} daily limit.`
                },
                429,
                cors(request)
            );
        }

        const body =
            await request.json();

        const message =
            String(
                body.message || ""
            ).trim();

        if (!message) {
            return json(
                {
                    error:
                        "Message cannot be empty."
                },
                400,
                cors(request)
            );
        }

        if (message.length > 20000) {
            return json(
                {
                    error:
                        "Message is too long."
                },
                400,
                cors(request)
            );
        }

        const systemPrompt = `
You are Mazx, a coding-focused AI assistant.

Your job is to help users:
- write code
- debug code
- explain code
- refactor code
- design software
- create projects
- understand errors
- write tests
- improve existing programs

Be practical and accurate.

When the user asks for code, provide complete usable code when appropriate.

Never claim that you executed code unless you actually have an execution tool.

The user's Mazx plan is:
${user.plan.toUpperCase()}
`;

        const prompt =
            `${systemPrompt}

USER:
${message}`;

        const model =
            user.plan === "pro"
                ? PRO_MODEL
                : FREE_MODEL;

        const result =
            await env.AI.run(
                model,
                {
                    prompt,
                    max_tokens:
                        user.plan === "pro"
                            ? 2048
                            : 1024
                }
            );

        await incrementUsage(
            user.id,
            env
        );

        return json(
            {
                response:
                    result?.response ||
                    result?.result ||
                    JSON.stringify(result),

                usage: used + 1,

                limit
            },
            200,
            cors(request)
        );
    }

    /* -------------------------
       CREATE CONVERSATION
    ------------------------- */

    if (
        url.pathname ===
            "/api/conversations" &&
        method === "POST"
    ) {
        const user =
            await requireUser(
                request,
                env
            );

        const body =
            await request.json();

        const title =
            String(
                body.title ||
                "New chat"
            ).slice(0, 120);

        const result =
            await env.DB.prepare(`
                INSERT INTO conversations (
                    user_id,
                    title
                )
                VALUES (?, ?)
            `)
                .bind(
                    user.id,
                    title
                )
                .run();

        return json(
            {
                id:
                    result.meta.last_row_id,

                title
            },
            201,
            cors(request)
        );
    }

    /* -------------------------
       LIST CONVERSATIONS
    ------------------------- */

    if (
        url.pathname ===
            "/api/conversations" &&
        method === "GET"
    ) {
        const user =
            await requireUser(
                request,
                env
            );

        const rows =
            await env.DB.prepare(`
                SELECT
                    id,
                    title,
                    created_at
                FROM conversations
                WHERE user_id = ?
                ORDER BY id DESC
                LIMIT 50
            `)
                .bind(user.id)
                .all();

        return json(
            {
                conversations:
                    rows.results
            },
            200,
            cors(request)
        );
    }

    /* -------------------------
       ADMIN STATS
    ------------------------- */

    if (
        url.pathname ===
            "/api/admin/stats" &&
        method === "GET"
    ) {
        await requireAdmin(
            request,
            env
        );

        const users =
            await env.DB.prepare(`
                SELECT COUNT(*) AS count
                FROM users
            `).first();

        const pro =
            await env.DB.prepare(`
                SELECT COUNT(*) AS count
                FROM users
                WHERE plan = 'pro'
            `).first();

        const admins =
            await env.DB.prepare(`
                SELECT COUNT(*) AS count
                FROM users
                WHERE is_admin = 1
            `).first();

        return json(
            {
                users: users.count,
                pro: pro.count,
                admins: admins.count
            },
            200,
            cors(request)
        );
    }

    /* -------------------------
       ADMIN USER LIST
    ------------------------- */

    if (
        url.pathname ===
            "/api/admin/users" &&
        method === "GET"
    ) {
        await requireAdmin(
            request,
            env
        );

        const rows =
            await env.DB.prepare(`
                SELECT
                    id,
                    username,
                    email,
                    plan,
                    is_admin,
                    created_at
                FROM users
                ORDER BY id DESC
                LIMIT 200
            `).all();

        return json(
            {
                users:
                    rows.results
            },
            200,
            cors(request)
        );
    }

    /* -------------------------
       ADMIN CHANGE PLAN
    ------------------------- */

    if (
        url.pathname ===
            "/api/admin/users/plan" &&
        method === "POST"
    ) {
        await requireAdmin(
            request,
            env
        );

        const body =
            await request.json();

        const userId =
            Number(body.id);

        const plan =
            body.plan === "pro"
                ? "pro"
                : "free";

        await env.DB.prepare(`
            UPDATE users
            SET plan = ?
            WHERE id = ?
        `)
            .bind(
                plan,
                userId
            )
            .run();

        return json(
            {
                ok: true
            },
            200,
            cors(request)
        );
    }

    /* -------------------------
       DEVELOPMENT ADMIN UNLOCK
    ------------------------- */

    if (
        url.pathname ===
            "/api/dev/admin" &&
        method === "POST"
    ) {
        if (
            env.DEV_MODE !== "true"
        ) {
            return json(
                {
                    error:
                        "Development admin mode is disabled."
                },
                404,
                cors(request)
            );
        }

        const body =
            await request.json();

        /*
          ADMIN is intentionally only
          available while DEV_MODE=true.
        */

        if (
            String(body.password || "") !==
            "ADMIN"
        ) {
            return json(
                {
                    error:
                        "Invalid development password."
                },
                401,
                cors(request)
            );
        }

        const user =
            await getCurrentUser(
                request,
                env
            );

        if (!user) {
            return json(
                {
                    error:
                        "Log in first."
                },
                401,
                cors(request)
            );
        }

        await env.DB.prepare(`
            UPDATE users
            SET
                is_admin = 1,
                plan = 'pro'
            WHERE id = ?
        `)
            .bind(user.id)
            .run();

        return json(
            {
                ok: true,
                message:
                    "Development admin enabled."
            },
            200,
            cors(request)
        );
    }

    return json(
        {
            error: "API endpoint not found."
        },
        404,
        cors(request)
    );
}

/* -----------------------------
   Main Worker
----------------------------- */

export default {

    async fetch(request, env) {

        if (!env.SESSION_SECRET) {
            return new Response(
                "SESSION_SECRET has not been configured.",
                {
                    status: 500
                }
            );
        }

        const url =
            new URL(request.url);

        if (
            url.pathname.startsWith("/api/")
        ) {
            try {

                return await handleAPI(
                    request,
                    env
                );

            } catch (error) {

                if (
                    error instanceof Response
                ) {
                    return error;
                }

                console.error(error);

                return json(
                    {
                        error:
                            "Internal server error."
                    },
                    500,
                    cors(request)
                );
            }
        }

        return env.ASSETS.fetch(
            request
        );
    }
};
