// Thin wrapper around zca-js so your controllers can stay clean
// Uses DB session (cookies, imei, userAgent) to login and return API instance
import { createRequire } from 'module';
import * as sessionRepo from '../repositories/session.repository.js';

const require = createRequire(import.meta.url);

let apiInstance = null; // holds zca-js API after login
let lastLoginAt = 0;

async function getApi() {
  if (apiInstance && Date.now() - lastLoginAt < 1000 * 60 * 30) {
    return apiInstance; // reuse within 30 minutes, adjust if needed
  }

  const { Zalo } = require('zca-js');
  const active = await sessionRepo.getActiveSession();
  if (!active || !active.cookies_json || !active.imei || !active.user_agent) {
    throw new Error('Zalo session not configured. Please set active session via /api/session');
  }

  const zalo = new Zalo();
  const api = await zalo.loginCookie({
    cookie: active.cookies_json,
    imei: active.imei,
    userAgent: active.user_agent,
    language: active.language || 'vi',
  });
  apiInstance = api;
  lastLoginAt = Date.now();
  return apiInstance;
}

export async function sendMessage(params) {
  const api = await getApi();
  return api.sendMessage(params);
}

export async function getUserInfo(userId) {
  const api = await getApi();
  return api.getUserInfo(userId);
}

export default {
  getApi,
  sendMessage,
  getUserInfo,
};
