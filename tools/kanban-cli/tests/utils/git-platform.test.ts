import { describe, it, expect } from 'vitest';
import {
  detectGitPlatform,
  parsePlatformFromUrl,
  getGitRemoteUrl,
} from '../../src/utils/git-platform.js';
import type { GitPlatform } from '../../src/utils/git-platform.js';

describe('parsePlatformFromUrl', () => {
  it('detects github.com HTTPS URL', () => {
    expect(parsePlatformFromUrl('https://github.com/org/repo.git')).toBe('github');
  });

  it('detects github.com SSH URL', () => {
    expect(parsePlatformFromUrl('git@github.com:org/repo.git')).toBe('github');
  });

  it('detects gitlab.com HTTPS URL', () => {
    expect(parsePlatformFromUrl('https://gitlab.com/org/repo.git')).toBe('gitlab');
  });

  it('detects gitlab.com SSH URL', () => {
    expect(parsePlatformFromUrl('git@gitlab.com:org/repo.git')).toBe('gitlab');
  });

  it('detects self-hosted GitLab (gitlab.company.com)', () => {
    expect(parsePlatformFromUrl('https://gitlab.mycompany.com/org/repo.git')).toBe('gitlab');
  });

  it('returns unknown for bitbucket', () => {
    expect(parsePlatformFromUrl('https://bitbucket.org/org/repo.git')).toBe('unknown');
  });

  it('returns unknown for empty string', () => {
    expect(parsePlatformFromUrl('')).toBe('unknown');
  });

  it('is case-insensitive', () => {
    expect(parsePlatformFromUrl('https://GITHUB.COM/org/repo.git')).toBe('github');
    expect(parsePlatformFromUrl('https://GITLAB.COM/org/repo.git')).toBe('gitlab');
  });
});

describe('detectGitPlatform', () => {
  const mockRemote = (url: string | null) => () => url;

  describe('env var override', () => {
    it('uses envValue=github directly', () => {
      const result = detectGitPlatform({
        envValue: 'github',
        getRemoteUrl: mockRemote(null),
      });
      expect(result).toBe('github');
    });

    it('uses envValue=gitlab directly', () => {
      const result = detectGitPlatform({
        envValue: 'gitlab',
        getRemoteUrl: mockRemote(null),
      });
      expect(result).toBe('gitlab');
    });

    it('envValue=auto triggers auto-detection', () => {
      const result = detectGitPlatform({
        envValue: 'auto',
        getRemoteUrl: mockRemote('https://github.com/org/repo.git'),
      });
      expect(result).toBe('github');
    });

    it('envValue takes priority over configValue', () => {
      const result = detectGitPlatform({
        envValue: 'github',
        configValue: 'gitlab',
        getRemoteUrl: mockRemote(null),
      });
      expect(result).toBe('github');
    });
  });

  describe('config value override', () => {
    it('uses configValue=github when envValue is not set', () => {
      const result = detectGitPlatform({
        configValue: 'github',
        getRemoteUrl: mockRemote(null),
      });
      expect(result).toBe('github');
    });

    it('uses configValue=gitlab when envValue is not set', () => {
      const result = detectGitPlatform({
        configValue: 'gitlab',
        getRemoteUrl: mockRemote(null),
      });
      expect(result).toBe('gitlab');
    });

    it('configValue=auto triggers auto-detection', () => {
      const result = detectGitPlatform({
        configValue: 'auto',
        getRemoteUrl: mockRemote('https://gitlab.com/org/repo.git'),
      });
      expect(result).toBe('gitlab');
    });
  });

  describe('auto-detection from remote URL', () => {
    it('detects github from remote URL', () => {
      const result = detectGitPlatform({
        getRemoteUrl: mockRemote('git@github.com:org/repo.git'),
      });
      expect(result).toBe('github');
    });

    it('detects gitlab from remote URL', () => {
      const result = detectGitPlatform({
        getRemoteUrl: mockRemote('git@gitlab.mycompany.com:org/repo.git'),
      });
      expect(result).toBe('gitlab');
    });

    it('returns unknown when remote URL is null', () => {
      const result = detectGitPlatform({
        getRemoteUrl: mockRemote(null),
      });
      expect(result).toBe('unknown');
    });

    it('returns unknown when remote URL is unrecognized', () => {
      const result = detectGitPlatform({
        getRemoteUrl: mockRemote('https://bitbucket.org/org/repo.git'),
      });
      expect(result).toBe('unknown');
    });
  });

  describe('full resolution order', () => {
    it('env > config > remote', () => {
      // env says github, config says gitlab, remote says gitlab
      const result = detectGitPlatform({
        envValue: 'github',
        configValue: 'gitlab',
        getRemoteUrl: mockRemote('https://gitlab.com/org/repo.git'),
      });
      expect(result).toBe('github');
    });

    it('config > remote when env is auto', () => {
      const result = detectGitPlatform({
        envValue: 'auto',
        configValue: 'gitlab',
        getRemoteUrl: mockRemote('https://github.com/org/repo.git'),
      });
      expect(result).toBe('gitlab');
    });

    it('remote used when both env and config are auto', () => {
      const result = detectGitPlatform({
        envValue: 'auto',
        configValue: 'auto',
        getRemoteUrl: mockRemote('https://github.com/org/repo.git'),
      });
      expect(result).toBe('github');
    });
  });
});

describe('getGitRemoteUrl', () => {
  // This test exercises the real git command.
  // It will return a URL if we are in a git repo with an origin remote,
  // or null otherwise. We just verify it doesn't throw.
  it('returns a string or null without throwing', () => {
    const result = getGitRemoteUrl();
    expect(result === null || typeof result === 'string').toBe(true);
  });
});
