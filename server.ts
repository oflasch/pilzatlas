import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { fetchHighResNRWGeodata } from './src/server/nrwGeodataProxy.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'pilzatlas-nrw-geodata-proxy',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/nrw/geodata', async (req, res) => {
    const south = Number(req.query.south);
    const west = Number(req.query.west);
    const north = Number(req.query.north);
    const east = Number(req.query.east);

    if (
      !Number.isFinite(south) ||
      !Number.isFinite(west) ||
      !Number.isFinite(north) ||
      !Number.isFinite(east) ||
      north <= south ||
      east <= west
    ) {
      res.status(400).json({
        error: 'Ungültige Kartenkoordinaten. Erwartet werden gültige Werte für Süd, West, Nord und Ost.',
      });
      return;
    }

    try {
      const payload = await fetchHighResNRWGeodata({ south, west, north, east });
      res.setHeader('Cache-Control', 'public, max-age=600');
      res.json(payload);
    } catch (err) {
      console.error('[nrw-geodata-proxy] error:', err);
      res.status(502).json({
        error: err instanceof Error ? err.message : 'OpenGeodata.NRW-WFS-Ebenen konnten nicht abgerufen werden.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PilzAtlas NRW server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
