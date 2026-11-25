import { describe, it, expect } from 'vitest';
import {
  buildPublicStorageTestPayload,
  canTestPublicStorageConnection,
} from '../publicStorageTestPayload.js';

describe('buildPublicStorageTestPayload', () => {
  const form = {
    endpoint_url: ' https://s3.example.com ',
    bucket: 'pub',
    region: 'us-east-1',
    access_key_id: 'AKIA',
    public_base_url: 'https://cdn.example.com',
  };

  it('includes a typed secret', () => {
    expect(buildPublicStorageTestPayload(form, '  secret  ', false)).toEqual({
      endpoint_url: 'https://s3.example.com',
      bucket: 'pub',
      region: 'us-east-1',
      access_key_id: 'AKIA',
      public_base_url: 'https://cdn.example.com',
      secret_access_key: 'secret',
    });
  });

  it('omits secret_access_key when saved secret should be used', () => {
    const payload = buildPublicStorageTestPayload(form, '', true);
    expect(payload.secret_access_key).toBeUndefined();
  });

  it('sends empty secret when the user cleared a saved secret', () => {
    const payload = buildPublicStorageTestPayload(form, '', true, true);
    expect(payload.secret_access_key).toBe('');
  });

  it('sends empty secret for IAM-style tests', () => {
    expect(buildPublicStorageTestPayload(form, '', false)).toMatchObject({
      secret_access_key: '',
    });
  });
});

describe('canTestPublicStorageConnection', () => {
  const base = {
    endpoint_url: 'https://s3.example.com',
    bucket: 'pub',
    region: 'us-east-1',
    access_key_id: '',
    public_base_url: 'https://cdn.example.com',
  };

  it('allows IAM when keys are empty', () => {
    expect(canTestPublicStorageConnection(base, '', false)).toBe(true);
  });

  it('allows access key with a saved secret', () => {
    expect(canTestPublicStorageConnection({ ...base, access_key_id: 'AKIA' }, '', true)).toBe(true);
  });

  it('allows access key with a typed secret', () => {
    expect(
      canTestPublicStorageConnection({ ...base, access_key_id: 'AKIA' }, 'secret', false)
    ).toBe(true);
  });

  it('rejects access key without any secret', () => {
    expect(canTestPublicStorageConnection({ ...base, access_key_id: 'AKIA' }, '', false)).toBe(
      false
    );
  });

  it('allows IAM after clearing a saved secret in the form', () => {
    expect(canTestPublicStorageConnection(base, '', true, true)).toBe(true);
  });
});
