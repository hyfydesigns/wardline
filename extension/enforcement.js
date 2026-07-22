// Wardline enforcement — pure decision logic.
//
// Classic script (no import/export) so the service worker can load it with
// importScripts() and the test harness can run it in a vm sandbox. Everything
// is a pure function of (policy, url); background.js wires these to
// webNavigation and applies the results. Exposed on globalThis.WardlineEnforce.
(function (root) {
  'use strict';

  /** Representative host lists per filter category. Suffix-matched. */
  const CATEGORY_HOSTS = {
    adult: ['pornhub.com', 'xvideos.com', 'xnxx.com', 'onlyfans.com', 'redtube.com'],
    gambling: ['bet365.com', 'draftkings.com', 'fanduel.com', 'stake.com', 'pokerstars.com', 'roobet.com'],
    social: ['facebook.com', 'instagram.com', 'tiktok.com', 'snapchat.com', 'x.com', 'twitter.com', 'reddit.com', 'tumblr.com', 'discord.com'],
    gaming: ['roblox.com', 'epicgames.com', 'steampowered.com', 'miniclip.com', 'poki.com', 'crazygames.com'],
    streaming: ['youtube.com', 'netflix.com', 'hulu.com', 'twitch.tv', 'disneyplus.com'],
  };

  /** Search engines and the query param that forces safe results. */
  const SAFE_SEARCH = [
    { match: /(^|\.)google\./i, param: 'safe', value: 'active' },
    { match: /(^|\.)bing\.com$/i, param: 'adlt', value: 'strict' },
    { match: /(^|\.)duckduckgo\.com$/i, param: 'kp', value: '1' },
  ];

  function hostOf(urlStr) {
    try {
      return new URL(urlStr).hostname.toLowerCase();
    } catch {
      return '';
    }
  }

  function protocolOf(urlStr) {
    try {
      return new URL(urlStr).protocol;
    } catch {
      return '';
    }
  }

  /** True if `host` is `entry` or a subdomain of it. */
  function hostMatches(host, entry) {
    const e = String(entry).toLowerCase().replace(/^https?:\/\//, '').replace(/^\*?\.?/, '').replace(/\/.*$/, '');
    if (!e) return false;
    return host === e || host.endsWith('.' + e);
  }

  function inList(host, list) {
    return (list || []).some((entry) => hostMatches(host, entry));
  }

  function categoryReason(category) {
    const labels = {
      adult: 'Adult content is blocked',
      gambling: 'Gambling sites are blocked',
      social: 'Social media is blocked',
      gaming: 'Gaming sites are blocked',
      streaming: 'Streaming is blocked',
    };
    return labels[category] || 'Blocked by category filter';
  }

  /**
   * Decide whether a navigation should be blocked.
   * Order: explicit allow-list wins → active schedule/limit block → custom
   * block-list → category filters → allow. Non-http schemes are always allowed.
   */
  function evaluate(policy, urlStr) {
    const host = hostOf(urlStr);
    if (!host || !/^https?:$/i.test(protocolOf(urlStr))) {
      return { block: false, reason: null };
    }
    if (inList(host, policy.allowed)) {
      return { block: false, reason: 'allow-list' };
    }
    if (policy.activeBlock && policy.activeBlock.blocked) {
      return { block: true, reason: policy.activeBlock.reason || 'Internet paused' };
    }
    if (inList(host, policy.blocked)) {
      return { block: true, reason: 'Blocked by your parent' };
    }
    const filters = policy.filters || {};
    for (const category of Object.keys(CATEGORY_HOSTS)) {
      if (filters[category] && inList(host, CATEGORY_HOSTS[category])) {
        return { block: true, reason: categoryReason(category) };
      }
    }
    return { block: false, reason: null };
  }

  /**
   * If SafeSearch is on and this is a search engine missing the safe param,
   * return a rewritten URL to redirect to. Otherwise null (no change).
   */
  function enforceSafeSearch(policy, urlStr) {
    if (!policy.safeSearch) return null;
    const host = hostOf(urlStr);
    const engine = SAFE_SEARCH.find((e) => e.match.test(host));
    if (!engine) return null;
    let url;
    try {
      url = new URL(urlStr);
    } catch {
      return null;
    }
    if (url.searchParams.get(engine.param) === engine.value) return null; // already safe
    url.searchParams.set(engine.param, engine.value);
    return url.toString();
  }

  root.WardlineEnforce = { evaluate, enforceSafeSearch, hostOf, hostMatches, CATEGORY_HOSTS };
})(typeof globalThis !== 'undefined' ? globalThis : self);
