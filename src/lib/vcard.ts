import type { PublicProfileRecord } from '../types';
import { stripHtmlToPlainText } from './richText';

function escapeVCard(val?: string): string {
  if (!val) return '';
  return val
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

export function buildPublicVCard(profile: PublicProfileRecord, publicUrl: string): string {
  const info = profile.personalInformation || {};
  const fullName = info.fullName || profile.slug;
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || '';

  const lines: string[] = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${escapeVCard(fullName)}`,
    `N:${escapeVCard(lastName)};${escapeVCard(firstName)};;;`,
  ];

  const primaryPhone = info.mobile || info.parentMobile || info.ownerMobile || info.emergencyContactPhone;
  if (info.companyName) lines.push(`ORG:${escapeVCard(info.companyName)}`);
  if (info.jobTitle) lines.push(`TITLE:${escapeVCard(info.jobTitle)}`);
  if (primaryPhone) lines.push(`TEL;TYPE=CELL,VOICE:${primaryPhone}`);
  if (info.whatsapp && info.whatsapp !== primaryPhone) lines.push(`TEL;TYPE=CELL:${info.whatsapp}`);
  if (info.emergencyContactPhone && info.emergencyContactPhone !== primaryPhone) {
    lines.push(`TEL;TYPE=HOME,VOICE:${info.emergencyContactPhone}`);
  }
  if (info.alternateMobile) lines.push(`TEL;TYPE=WORK,VOICE:${info.alternateMobile}`);
  if (info.email) lines.push(`EMAIL;TYPE=PREF,INTERNET:${info.email}`);
  if (info.alternateEmail) lines.push(`EMAIL;TYPE=INTERNET:${info.alternateEmail}`);
  if (info.website) lines.push(`URL:${info.website}`);
  lines.push(`URL;TYPE=DigitalProfile:${publicUrl}`);

  const streetAddr = info.businessAddress || info.personalAddress || '';
  if (streetAddr || info.city || info.state || info.pinCode || info.country) {
    lines.push(
      `ADR;TYPE=HOME:;;${escapeVCard(streetAddr)};${escapeVCard(info.city)};${escapeVCard(info.state)};${escapeVCard(info.pinCode)};${escapeVCard(info.country || 'India')}`
    );
  }

  const extraNotes: string[] = [];
  const plainBio = stripHtmlToPlainText(info.shortBio);
  if (plainBio) extraNotes.push(plainBio);
  if (info.bloodGroup) extraNotes.push(`Blood Group: ${info.bloodGroup}`);
  if (info.parentName || info.parentMobile) {
    extraNotes.push(`Parent: ${[info.parentName, info.parentMobile].filter(Boolean).join(' · ')}`);
  }
  if (info.ownerName || info.ownerMobile) {
    extraNotes.push(`Owner: ${[info.ownerName, info.ownerMobile].filter(Boolean).join(' · ')}`);
  }
  if (info.emergencyContactName || info.emergencyContactPhone) {
    extraNotes.push(
      `Emergency: ${[info.emergencyContactName, info.emergencyContactRelation, info.emergencyContactPhone].filter(Boolean).join(' · ')}`
    );
  }
  if (info.allergiesOrMedical) extraNotes.push(`Medical/Allergies: ${info.allergiesOrMedical}`);
  if (info.petType || info.breed) extraNotes.push(`Pet: ${[info.petType, info.breed].filter(Boolean).join(' · ')}`);
  if (info.itemCategory || info.brandModel) {
    const itemCatLabel =
      info.itemCategory === 'Other' && info.itemCategoryOther?.trim()
        ? info.itemCategoryOther.trim()
        : info.itemCategory;
    extraNotes.push(`Item: ${[itemCatLabel, info.brandModel].filter(Boolean).join(' · ')}`);
  }
  if (info.finderNotes) extraNotes.push(`Finder Notes: ${info.finderNotes}`);
  if (extraNotes.length > 0) {
    lines.push(`NOTE:${escapeVCard(extraNotes.join(' | '))}`);
  }

  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export function downloadVCard(profile: PublicProfileRecord, publicUrl: string): void {
  const vcfContent = buildPublicVCard(profile, publicUrl);
  const blob = new Blob([vcfContent], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${profile.slug || 'contact'}.vcf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
