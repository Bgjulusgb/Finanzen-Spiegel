{
  "database": {
    "path": "./data/pressespiegel.db",
    "backup_path": "./data/backups"
  },
  "reports": {
    "path": "./reports",
    "default_format": "html",
    "include_pdf": false,
    "max_articles_per_section": 200,
    "max_summary_length": 320
  },
  "scraping": {
    "user_agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
    "request_timeout_ms": 15000,
    "max_retries": 2,
    "retry_backoff_ms": 1500,
    "max_concurrent_requests": 8,
    "rate_limit_per_domain_ms": 800,
    "auto_disable_after_failures": 6,
    "max_articles_per_scan": 1500,
    "puppeteer_fallback": true,
    "puppeteer": {
      "headless": true,
      "navigation_timeout_ms": 30000,
      "wait_until": "networkidle2"
    }
  },
  "deduplication": {
    "title_similarity_threshold": 0.85,
    "text_similarity_threshold": 0.8,
    "first_paragraph_chars": 800,
    "enabled": true
  },
  "schedule": {
    "daily_scan_cron": "0 6 * * *",
    "daily_scan_lookback_hours": 24,
    "weekly_report_cron": "0 8 * * 1",
    "monthly_report_cron": "0 8 1 * *",
    "timezone": "Europe/Berlin"
  },
  "logging": {
    "level": "info",
    "max_file_size_mb": 10,
    "max_files": 14,
    "console": true
  },
  "search": {
    "bm25": {
      "k1": 1.5,
      "b": 0.75,
      "title_boost": 4,
      "summary_boost": 1,
      "body_boost": 1,
      "recency_half_life_days": 30,
      "recency_mode": "exponential",
      "with_compound_split": true,
      "with_phonetic": true,
      "with_positions": true,
      "with_bigrams": true,
      "bigram_boost": 0.5,
      "phrase_title_bonus": 0.3
    },
    "fuse": {
      "threshold": 0.45,
      "distance": 200,
      "min_match_chars": 3,
      "weights": {
        "title": 0.5,
        "summary": 0.3,
        "source": 0.1,
        "author": 0.05,
        "full_text": 0.05
      }
    },
    "hybrid": {
      "bm25_weight": 0.65,
      "fuse_weight": 0.35,
      "default_limit": 50,
      "source_boost_high_threshold": 95,
      "source_boost_high": 1.1,
      "source_boost_mid_threshold": 80,
      "source_boost_mid": 1.05
    },
    "cache": {
      "max_entries": 200,
      "ttl_ms": 60000,
      "tokenize_cache_max": 5000
    },
    "suggestions": {
      "max_results": 10,
      "min_prefix_length": 2
    },
    "did_you_mean": {
      "min_query_length": 4,
      "max_distance": 3
    },
    "tokenizer": {
      "min_token_length": 3,
      "min_phonetic_length": 4,
      "proximity_max_window": 8
    },
    "stopwords": {
      "disable_defaults": false,
      "custom": []
    }
  }
}
