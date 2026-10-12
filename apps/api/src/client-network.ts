import { isIP } from 'node:net';

export function clientNetworkIdentifier(address: string): string {
  const withoutZone = address.trim().toLowerCase().split('%', 1)[0] ?? '';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(withoutZone)?.[1];
  if (mapped && isIP(mapped) === 4) return ipv4Network(mapped);
  if (isIP(withoutZone) === 4) return ipv4Network(withoutZone);
  if (isIP(withoutZone) === 6) {
    const groups = expandIpv6(withoutZone);
    if (groups) return `${groups.slice(0, 4).join(':')}::/64`;
  }
  return 'unresolved';
}

function ipv4Network(address: string): string {
  const octets = address.split('.');
  return `${octets.slice(0, 3).join('.')}.0/24`;
}

function expandIpv6(address: string): string[] | undefined {
  const halves = address.split('::');
  if (halves.length > 2) return undefined;
  const left = ipv6Half(halves[0] ?? '');
  const right = ipv6Half(halves[1] ?? '');
  if (!left || !right) return undefined;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return undefined;
  return [...left, ...Array.from({ length: missing }, () => '0000'), ...right];
}

function ipv6Half(value: string): string[] | undefined {
  if (!value) return [];
  const groups = value.split(':');
  const last = groups.at(-1);
  if (last && isIP(last) === 4) {
    const octets = last.split('.').map(Number);
    if (octets.length !== 4 || octets.some((octet) => octet < 0 || octet > 255)) return undefined;
    groups.splice(
      -1,
      1,
      ((octets[0] ?? 0) * 256 + (octets[1] ?? 0)).toString(16),
      ((octets[2] ?? 0) * 256 + (octets[3] ?? 0)).toString(16),
    );
  }
  if (groups.some((group) => !/^[a-f0-9]{1,4}$/u.test(group))) return undefined;
  return groups.map((group) => group.padStart(4, '0'));
}
