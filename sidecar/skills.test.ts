import { describe, it, expect } from 'vitest';
import { sanitizeSkillName } from './skills.js';

describe('sanitizeSkillName', () => {
  it('lowercases and replaces spaces with dashes', () => {
    expect(sanitizeSkillName('My Cool Skill')).toBe('my-cool-skill');
  });

  it('strips non-alphanumeric characters', () => {
    expect(sanitizeSkillName('hello!')).toBe('hello');
  });

  it('strips leading and trailing dashes', () => {
    expect(sanitizeSkillName('--foo--')).toBe('foo');
  });

  it('collapses multiple consecutive dashes', () => {
    expect(sanitizeSkillName('foo---bar')).toBe('foo-bar');
  });

  it('allows underscores', () => {
    expect(sanitizeSkillName('my_skill')).toBe('my_skill');
  });

  it('returns empty string for all-special input', () => {
    expect(sanitizeSkillName('!!!')).toBe('');
  });
});
