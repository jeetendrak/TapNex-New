import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FulfilmentTimeline } from '../src/components/FulfilmentTimeline';
import fs from 'fs';
import path from 'path';

describe('FulfilmentTimeline milestone advancement', () => {
  it('renders interactive milestone buttons including Printing in Progress and Advance button', () => {
    const onSelectStatus = vi.fn();
    const html = renderToStaticMarkup(
      <FulfilmentTimeline
        currentStatus="Assigned to Printer"
        interactive
        allowedStatuses={[
          'Processing',
          'Assigned to Printer',
          'Printing in Progress',
          'Quality Check',
          'Ready for Dispatch',
          'Dispatched',
          'In Transit',
          'Delivered',
        ]}
        onSelectStatus={onSelectStatus}
      />
    );

    expect(html).toContain('Advance: Printing in Progress');
    expect(html).toContain('title="Set status to &quot;Printing in Progress&quot;"');
    expect(html).toContain('Current');
  });

  it('shows Updating label on Advance button while status transition is in progress', () => {
    const html = renderToStaticMarkup(
      <FulfilmentTimeline
        currentStatus="Assigned to Printer"
        interactive
        updating
        allowedStatuses={['Assigned to Printer', 'Printing in Progress']}
        onSelectStatus={vi.fn()}
      />
    );

    expect(html).toContain('Updating...');
    expect(html).not.toContain('Advance: Printing in Progress');
  });

  it('routes printer and admin timeline step updates through updateServerOrderStatus with catch error reporting', () => {
    const printerSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/printer/PrinterPortalPages.tsx'),
      'utf8'
    );
    const adminSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/admin/AdminPortalPages.tsx'),
      'utf8'
    );

    expect(printerSrc).toContain('updateServerOrderStatus(order.orderId, nextStatus)');
    expect(printerSrc).toContain("'Status update failed'");
    expect(printerSrc).toContain('createServerShippingRecord(');
    expect(adminSrc).toContain('updateServerOrderStatus(order.orderId, nextStatus)');
    expect(adminSrc).toContain("'Fulfilment update failed'");
    expect(adminSrc).toContain('createServerShippingRecord(');
  });
});
