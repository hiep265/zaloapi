import zaloService from '../services/zalo.service.js';

export async function handleWebhook(req, res, next) {
  try {
    // TODO: verify signature with Zalo secret (if applicable) before processing
    const payload = req.body;

    // Basic echo/log behavior for now
    console.log('Incoming Zalo webhook:', JSON.stringify(payload));

    // Example: if message event, you could reply via zaloService
    // await zaloService.sendMessage({ to: 'userId', text: 'Hello from Express + zca-js' });

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}
