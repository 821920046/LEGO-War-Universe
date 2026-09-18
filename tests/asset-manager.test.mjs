import test from 'node:test';
import assert from 'node:assert/strict';
import assets from '../02_Assets/assets.json' with { type: 'json' };
import profiles from '../02_Assets/model-profiles.json' with { type: 'json' };
import { createRegistry } from '../src/domain/registry.js';

const registry = createRegistry(assets, profiles, { references: [] });

test('Asset manager data: registry contains standard asset categories and IDs', () => {
  const characters = registry.byKind.get('character') || [];
  const vehicles = registry.byKind.get('vehicle') || [];
  assert.ok(characters.length > 0);
  assert.ok(vehicles.length > 0);

  // Check ID format
  const validIdPattern = /^[A-Z]{2,5}-[0-9]{3}$/;
  assert.ok(validIdPattern.test(characters[0].id));
  assert.ok(validIdPattern.test(vehicles[0].id));
});
