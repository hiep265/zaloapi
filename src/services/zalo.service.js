// Thin wrapper around zca-js so your controllers can stay clean
// Uses DB session (cookies, imei, userAgent) to login and return API instance
import { createRequire } from 'module';
import * as sessionRepo from '../repositories/session.repository.js';
import sharp from 'sharp';
import fs from 'fs';

const require = createRequire(import.meta.url);

async function imageMetadataGetter(filePath) {
  const data = await fs.promises.readFile(filePath);
  const metadata = await sharp(data).metadata();
  return {
    height: metadata.height,
    width: metadata.width,
    size: metadata.size || data.length,
  };
}

let apiInstance = null; // holds zca-js API after login
let lastLoginAt = 0;
const perSessionCache = new Map(); // key: session_key -> { api, lastLoginAt }

export async function getApi() {
  if (apiInstance && Date.now() - lastLoginAt < 1000 * 60 * 30) {
    return apiInstance; // reuse within 30 minutes, adjust if needed
  }

  const { Zalo } = require('zca-js');
  const active = await sessionRepo.getActiveSession();
  if (!active || !active.cookies_json || !active.imei || !active.user_agent) {
    throw new Error('Zalo session not configured. Please set active session via /api/session');
  }

  const zalo = new Zalo({ checkUpdate: false, imageMetadataGetter });
  const api = await zalo.login({
    cookie: active.cookies_json,
    imei: active.imei,
    userAgent: active.user_agent,
    language: active.language || 'vi',
  });
  apiInstance = api;
  lastLoginAt = Date.now();
  return apiInstance;
}

export async function getApiForSession(session_key) {
  const cache = perSessionCache.get(String(session_key));
  if (cache && cache.api && Date.now() - cache.lastLoginAt < 1000 * 60 * 30) {
    return cache.api;
  }

  const { Zalo } = require('zca-js');
  const row = await sessionRepo.getBySessionKey(String(session_key));
  if (!row || !row.cookies_json || !row.imei || !row.user_agent) {
    throw new Error('Session not found or missing credentials for the specified session_key');
  }
  const zalo = new Zalo({ checkUpdate: false, imageMetadataGetter });
  const api = await zalo.login({
    cookie: row.cookies_json,
    imei: row.imei,
    userAgent: row.user_agent,
    language: row.language || 'vi',
  });
  perSessionCache.set(String(session_key), { api, lastLoginAt: Date.now() });
  return api;
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
