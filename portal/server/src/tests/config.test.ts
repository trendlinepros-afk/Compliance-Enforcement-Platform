import { describe, expect, it } from 'vitest';
import { normalizePublicUrl } from '../config';

describe('normalizePublicUrl', () => {
  it('adds https:// to a schemeless host (the Railway footgun)', () => {
    expect(normalizePublicUrl('compliance-enforcement-platform-production.up.railway.app')).toBe(
      'https://compliance-enforcement-platform-production.up.railway.app',
    );
  });

  it('preserves an explicit https:// url', () => {
    expect(normalizePublicUrl('https://cep.example.com')).toBe('https://cep.example.com');
  });

  it('preserves an explicit http:// url', () => {
    expect(normalizePublicUrl('http://cep.example.com')).toBe('http://cep.example.com');
  });

  it('strips trailing slashes', () => {
    expect(normalizePublicUrl('https://cep.example.com/')).toBe('https://cep.example.com');
    expect(normalizePublicUrl('cep.example.com///')).toBe('https://cep.example.com');
  });

  it('keeps localhost on http for local dev', () => {
    expect(normalizePublicUrl('http://localhost:8080')).toBe('http://localhost:8080');
    expect(normalizePublicUrl('localhost:8080')).toBe('http://localhost:8080');
    expect(normalizePublicUrl('localhost')).toBe('http://localhost');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizePublicUrl('  https://cep.example.com  ')).toBe('https://cep.example.com');
  });
});
