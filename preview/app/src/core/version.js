import{IS_LOCAL as P}from"../lib/env.js";const r="1.0";let o="v1.0.1009";if(P)try{const t=await import("./version.local.js");t?.APP_VERSION&&(o=t.APP_VERSION)}catch{}export const APP_VERSION=o;
