// Elite wallet set — confirmation signal ONLY, never the entry trigger.
// Hand-picked top performers from the old 156-wallet roster (verified 2026-10-05).
// The desk scores the TOKEN first; these wallets just add a small confidence boost
// when one of them holds/bought it, and feed the smart-money exit check.

export const ELITE = [
  { label: 'Unipcs', address: '2heJbC32Tpfcb3nbUb5ER61K11FGZVfVGtVnDm6LDogF' },
  { label: 'pointfarmcap', address: 'Beqv6dzTcjV2eodo8RRXCiCcnSYrS1vkQKhfqwHXqeit' },
  { label: 'TheSolstice', address: '4ugDhHJ8XDXAeABmrNmGffFaLbJb9BkPyiFGVSV9ocwo' },
  { label: 'Salem', address: '2yXwy5Dsa1XtEXcsrkFVRJeyuWD3qKkMN3pP3p5VTW3V' },
  { label: 'AJC', address: 'H2QSGECp13sFLJgdTsDtayX3dk18Dm6sQMSQKcew7Xzk' },
  { label: 'frank', address: '498g1rVnFcnjBjpfw1xyqA1WvgQXUU8RWuELjxkjAayQ' },
  { label: 'change', address: 'J9WiAZKf8JnCkHFL8fLCCXdEgdoLjLRqU2EGsDjdqYga' },
  { label: 'Idontpaytaxes', address: '2T5NgDDidkvhJQg8AHDi74uCFwgp25pYFMRZXBaCUNBH' },
  { label: '0xEthan', address: '6yVb4pxNwDfr6rovwNnBg3SyKSvDcHGD4WdFPN1JJBqm' },
  { label: 'Jijo', address: '4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk' },
  { label: 'zeropnl', address: '4xY9T1Q7foJzJsJ6YZDSsfp9zkzeZsXnxd45SixduMmr' },
  { label: 'Cooker', address: '8deJ9xeUvXSJwicYptA9mHsU2rN2pDx37KWzkDkEXhU6' },
  { label: 'ansem', address: 'AVAZvHLR2PcWpDf8BXY4rVxNHYRBytycHkcB5z5QNXYm' },
  { label: 'Rasmr', address: '9CNyLECt2j8tnDhqxtjYk5HUhZ2b8Nwnyb7sfYN7vND2' },
  { label: 'Dior', address: '87rRdssFiTJKY4MGARa4G5vQ31hmR7MxSmhzeaJ5AAxJ' },
];

export function shortAddr(a) { return a ? a.slice(0, 4) + '…' + a.slice(-4) : ''; }
