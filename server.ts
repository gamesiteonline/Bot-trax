import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import QRCode from 'qrcode';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TRAX_DIR = fs.existsSync(path.resolve(__dirname, 'trax-md'))
  ? path.resolve(__dirname, 'trax-md')
  : path.resolve(process.cwd(), 'trax-md');
const SESSION_ROOT = process.env.VERCEL ? path.join(os.tmpdir(), 'trax-md') : TRAX_DIR;

interface CommandMeta {
  pattern: string;
  alias: string[];
  desc: string;
  category: string;
  fromMe: boolean;
}

let pluginsLoaded = false;

async function ensureBotModulesLoaded() {
  const cmdModuleUrl = pathToFileURL(path.join(TRAX_DIR, 'command.js')).href;
  const cmdMod = await import(cmdModuleUrl);
  if (!pluginsLoaded) {
    const pluginsDir = path.join(TRAX_DIR, 'plugins');
    if (fs.existsSync(pluginsDir)) {
      const files = fs.readdirSync(pluginsDir).filter((f) => f.endsWith('.js')).sort();
      for (const file of files) {
        await import(pathToFileURL(path.join(pluginsDir, file)).href);
      }
    }
    pluginsLoaded = true;
  }
  const configMod = await import(pathToFileURL(path.join(TRAX_DIR, 'config.js')).href);
  const handlerMod = await import(pathToFileURL(path.join(TRAX_DIR, 'lib', 'handler.js')).href);
  return {
    commands: (cmdMod.commands || []) as Array<Record<string, unknown>>,
    config: configMod.default as Record<string, unknown>,
    handleIncomingMessage: handlerMod.handleIncomingMessage as (
      sock: Record<string, unknown>,
      msg: Record<string, unknown>
    ) => Promise<Record<string, unknown>>,
  };
}

async function runNodeExec(args: string[]) {
  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      cwd: TRAX_DIR,
      timeout: 15000,
      env: { ...process.env, NO_COLOR: '1' },
    });
    return {
      exitCode: 0,
      durationMs: Date.now() - start,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  } catch (err: unknown) {
    const execErr = err as { code?: number; stdout?: string; stderr?: string; message?: string };
    return {
      exitCode: typeof execErr.code === 'number' ? execErr.code : 1,
      durationMs: Date.now() - start,
      stdout: (execErr.stdout || '').trim(),
      stderr: (execErr.stderr || execErr.message || '').trim(),
    };
  }
}

export function createApiApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/project-summary', async (_req, res) => {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(TRAX_DIR, 'package.json'), 'utf8')
      );
      const { commands, config } = await ensureBotModulesLoaded();
      const commandList: CommandMeta[] = commands.map((c) => ({
        pattern: String(c.pattern || ''),
        alias: Array.isArray(c.alias) ? c.alias.map(String) : [],
        desc: String(c.desc || ''),
        category: String(c.category || 'misc'),
        fromMe: Boolean(c.fromMe),
      }));

      res.json({
        name: pkg.name,
        displayName: String(config.BOT_NAME || 'TRAX MD'),
        version: pkg.version,
        developer: String(config.OWNER_NAME || 'TRAX'),
        license: pkg.license || 'Apache-2.0',
        prefix: String(config.PREFIX || '.'),
        mode: String(config.MODE || 'private'),
        dependenciesCount: Object.keys(pkg.dependencies || {}).length,
        hasNodeModules:
          fs.existsSync(path.join(TRAX_DIR, 'node_modules', '@whiskeysockets', 'baileys')) ||
          fs.existsSync(path.join(__dirname, 'node_modules', '@whiskeysockets', 'baileys')),
        commands: commandList,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load summary';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/verify', async (_req, res) => {
    const checkResult = await runNodeExec(['index.js', '--check']);
    const testResult = await runNodeExec(['--test', 'test/bot.test.js']);
    res.json({
      check: checkResult,
      tests: testResult,
      passed: checkResult.exitCode === 0 && testResult.exitCode === 0,
    });
  });

  app.post('/api/test-command', async (req, res) => {
    try {
      const { text = '.menu', isOwner = true, isGroup = false, pushName = 'TRAX Tester' } =
        req.body || {};
      const { config, handleIncomingMessage } = await ensureBotModulesLoaded();
      const previousMode = config.MODE;
      const previousPrefix = config.PREFIX;

      const sent: Array<{ jid: string; text: string; reaction?: string }> = [];
      const mockSock = {
        isSandbox: true,
        user: { id: '25570835837:1@s.whatsapp.net' },
        sendMessage: async (jid: string, payload: Record<string, unknown>) => {
          if (payload.react && typeof payload.react === 'object') {
            const r = payload.react as { text?: string };
            sent.push({ jid, text: '', reaction: r.text || '' });
          } else {
            sent.push({
              jid,
              text: String(payload.text || payload.caption || '[Media payload]'),
            });
          }
          return { key: { id: `sim-${Date.now()}` } };
        },
        groupMetadata: async () => ({
          subject: 'TRAX MD Preview Group',
          desc: 'Command verification sandbox',
          participants: [
            { id: '25570835837@s.whatsapp.net', admin: 'superadmin' },
            { id: '15551234567@s.whatsapp.net', admin: null },
          ],
        }),
      };

      const chatJid = isGroup ? '120363000000000@g.us' : '15551234567@s.whatsapp.net';
      const senderJid = isOwner
        ? '25570835837@s.whatsapp.net'
        : '15551234567@s.whatsapp.net';

      const result = await handleIncomingMessage(mockSock, {
        key: {
          remoteJid: chatJid,
          fromMe: Boolean(isOwner),
          participant: isGroup ? senderJid : undefined,
          id: `msg-${Date.now()}`,
        },
        pushName: String(pushName),
        message: { conversation: String(text) },
      });

      const replies = sent.filter((item) => item.text).map((item) => item.text);
      const reactions = sent.filter((item) => item.reaction).map((item) => item.reaction);

      res.json({
        result,
        replies,
        reactions,
        activeMode: config.MODE,
        activePrefix: config.PREFIX,
        previousMode,
        previousPrefix,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Simulation failed';
      res.status(500).json({ error: message });
    }
  });

  interface BotConnectionLike {
    getSnapshot: () => {
      status: string;
      authMethod: string;
      qr: string | null;
      pairingCode: string | null;
      user: { id: string; name: string } | null;
      lastError: string | null;
      commandsLoaded: number;
      sessionPresent: boolean;
      logs: Array<{ time: string; stage: string; message: string }>;
    };
    connect: (opts: {
      authMethod?: string;
      pairingNumber?: string;
      sessionId?: string;
    }) => Promise<unknown>;
    disconnect: () => Promise<unknown>;
    logout: () => Promise<unknown>;
  }

  interface BotServerDef {
    id: string;
    name: string;
    region: string;
    limit: number;
    sessionDir: string;
  }

  const BOT_SERVERS: BotServerDef[] = [
    {
      id: 'server-1',
      name: 'Server 1',
      region: 'Primary · EU-West',
      limit: 50,
      sessionDir: path.join(SESSION_ROOT, 'session'),
    },
    {
      id: 'server-2',
      name: 'Server 2',
      region: 'US-East',
      limit: 50,
      sessionDir: path.join(SESSION_ROOT, 'sessions', 'server-2'),
    },
    {
      id: 'server-3',
      name: 'Server 3',
      region: 'AF-East',
      limit: 50,
      sessionDir: path.join(SESSION_ROOT, 'sessions', 'server-3'),
    },
    {
      id: 'server-4',
      name: 'Server 4',
      region: 'AP-South',
      limit: 50,
      sessionDir: path.join(SESSION_ROOT, 'sessions', 'server-4'),
    },
    {
      id: 'server-5',
      name: 'Server 5',
      region: 'EU-Central',
      limit: 50,
      sessionDir: path.join(SESSION_ROOT, 'sessions', 'server-5'),
    },
    {
      id: 'server-6',
      name: 'Server 6',
      region: 'US-West',
      limit: 50,
      sessionDir: path.join(SESSION_ROOT, 'sessions', 'server-6'),
    },
  ];

  const ACTIVE_SOCKET_STATES = new Set([
    'connecting',
    'awaiting-qr',
    'pairing-ready',
    'reconnecting',
    'connected',
  ]);

  let connectionClassCache: (new (opts: { sessionDir: string }) => BotConnectionLike) | null = null;
  const botConnections = new Map<string, BotConnectionLike>();

  function resolveServerDef(serverId?: string): BotServerDef {
    const requested = String(serverId || 'server-1').trim();
    return BOT_SERVERS.find((s) => s.id === requested) || BOT_SERVERS[0];
  }

  async function getBotConnection(serverId?: string): Promise<{
    server: BotServerDef;
    conn: BotConnectionLike;
  }> {
    const server = resolveServerDef(serverId);
    let conn = botConnections.get(server.id);
    if (!conn) {
      if (!connectionClassCache) {
        const mod = await import(pathToFileURL(path.join(TRAX_DIR, 'lib', 'connection.js')).href);
        connectionClassCache = mod.TraxBotConnection as new (opts: {
          sessionDir: string;
        }) => BotConnectionLike;
      }
      conn = new connectionClassCache({ sessionDir: server.sessionDir });
      botConnections.set(server.id, conn);
    }
    return { server, conn };
  }

  function getServerCatalog() {
    return BOT_SERVERS.map((server) => {
      const conn = botConnections.get(server.id);
      if (conn) {
        const snap = conn.getSnapshot();
        const isActive = ACTIVE_SOCKET_STATES.has(snap.status);
        return {
          id: server.id,
          name: server.name,
          region: server.region,
          limit: server.limit,
          active: isActive ? 1 : 0,
          status: snap.status,
          sessionPresent: snap.sessionPresent,
          user: snap.user,
        };
      }
      const hasSavedCreds = fs.existsSync(path.join(server.sessionDir, 'creds.json'));
      return {
        id: server.id,
        name: server.name,
        region: server.region,
        limit: server.limit,
        active: 0,
        status: 'idle',
        sessionPresent: hasSavedCreds,
        user: null,
      };
    });
  }

  async function serializeBotSnapshot(server: BotServerDef, conn: BotConnectionLike) {
    const snap = conn.getSnapshot();
    let qrDataUrl: string | null = null;
    if (snap.qr) {
      try {
        qrDataUrl = await QRCode.toDataURL(snap.qr, {
          width: 280,
          margin: 2,
          color: { dark: '#000000', light: '#FFFFFF' },
        });
      } catch {
        qrDataUrl = null;
      }
    }
    return {
      ...snap,
      serverId: server.id,
      serverName: server.name,
      servers: getServerCatalog(),
      qrDataUrl,
    };
  }

  app.get('/api/bot/servers', (_req, res) => {
    res.json({ servers: getServerCatalog() });
  });

  app.get('/api/bot/status', async (req, res) => {
    try {
      const serverId = typeof req.query.serverId === 'string' ? req.query.serverId : undefined;
      const { server, conn } = await getBotConnection(serverId);
      res.json(await serializeBotSnapshot(server, conn));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to read bot status';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/bot/connect', async (req, res) => {
    try {
      const {
        serverId = 'server-1',
        authMethod = 'qr',
        pairingNumber = '',
        sessionId = '',
      } = req.body || {};
      const { server, conn } = await getBotConnection(String(serverId));
      await conn.connect({
        authMethod: String(authMethod),
        pairingNumber: String(pairingNumber),
        sessionId: String(sessionId),
      });
      res.json(await serializeBotSnapshot(server, conn));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to connect bot';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/bot/disconnect', async (req, res) => {
    try {
      const serverId = req.body?.serverId ? String(req.body.serverId) : undefined;
      const { server, conn } = await getBotConnection(serverId);
      await conn.disconnect();
      res.json(await serializeBotSnapshot(server, conn));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to disconnect bot';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/bot/logout', async (req, res) => {
    try {
      const serverId = req.body?.serverId ? String(req.body.serverId) : undefined;
      const { server, conn } = await getBotConnection(serverId);
      await conn.logout();
      res.json(await serializeBotSnapshot(server, conn));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to log out';
      res.status(500).json({ error: message });
    }
  });

  app.locals.restoreRegisteredServers = async () => {
    for (const srv of BOT_SERVERS) {
      const credsPath = path.join(srv.sessionDir, 'creds.json');
      if (!fs.existsSync(credsPath)) continue;
      try {
        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
        if (creds?.registered === true) {
          const { conn } = await getBotConnection(srv.id);
          void conn.connect({ authMethod: 'qr' }).catch(() => {});
        }
      } catch {
        // Ignore corrupt session on boot
      }
    }
  };

  return app;
}

async function startServer() {
  const app = createApiApp();

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`TRAX MD Console listening on http://0.0.0.0:${port}`);
    if (typeof app.locals.restoreRegisteredServers === 'function') {
      void app.locals.restoreRegisteredServers();
    }
  });
}

const isDirectEntry =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectEntry) {
  startServer().catch((err) => {
    console.error('Failed to start TRAX MD Console server:', err);
    process.exit(1);
  });
}
