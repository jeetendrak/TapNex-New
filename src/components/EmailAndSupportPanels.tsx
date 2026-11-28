import React, { useEffect, useState } from 'react';
import { LifeBuoy, Mail, RefreshCw, Send } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { formatEmailDeliveryFailureReason } from '../lib/dispatchEmailFeedback';
import {
  formatTimestampDate,
  getEmailNotifications,
  getEmailTemplates,
  getResendSenderConfig,
  getSupportTickets,
  saveEmailTemplate,
  saveResendSenderConfig,
  sendTestTransactionalEmail,
  updateSupportTicket,
  type ResendSenderConfig,
} from '../lib/firestoreService';
import type { EmailTemplateRecord, NotificationRecord, SupportTicketRecord } from '../types';

export const EmailDeliveryManagementPanel: React.FC<{
  onLogsCountChange?: (count: number) => void;
}> = ({ onLogsCountChange }) => {
  const { userRecord } = useAuth();
  const { notify } = useToast();
  const [emailLogs, setEmailLogs] = useState<NotificationRecord[]>([]);
  const [loadingEmailLogs, setLoadingEmailLogs] = useState(false);
  const [senderConfig, setSenderConfig] = useState<ResendSenderConfig>({
    fromName: 'TapNex',
    fromEmail: 'orders@tapnex.in',
  });
  const [savingSenderConfig, setSavingSenderConfig] = useState(false);
  const [testEmailTarget, setTestEmailTarget] = useState('');
  const [sendingTestEmail, setSendingTestEmail] = useState(false);
  const [testEmailStatus, setTestEmailStatus] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  useEffect(() => {
    if (userRecord?.email && !testEmailTarget) {
      setTestEmailTarget(userRecord.email);
    }
  }, [userRecord?.email, testEmailTarget]);

  const loadEmailDiagnostics = async () => {
    setLoadingEmailLogs(true);
    try {
      const [logs, cfg] = await Promise.all([
        getEmailNotifications(100),
        getResendSenderConfig(),
      ]);
      setEmailLogs(logs);
      onLogsCountChange?.(logs.length);
      setSenderConfig(cfg);
    } finally {
      setLoadingEmailLogs(false);
    }
  };

  useEffect(() => {
    void loadEmailDiagnostics();
  }, []);

  const handleSaveSenderConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRecord || userRecord.role !== 'SUPERADMIN') return;
    setSavingSenderConfig(true);
    try {
      await saveResendSenderConfig(senderConfig, {
        uid: userRecord.uid,
        email: userRecord.email,
        role: userRecord.role,
      });
      notify('Sender configuration saved', `${senderConfig.fromName} <${senderConfig.fromEmail}>`, 'success');
    } catch (err) {
      notify('Save failed', err instanceof Error ? err.message : 'Unable to save sender config.', 'error');
    } finally {
      setSavingSenderConfig(false);
    }
  };

  const handleSendTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRecord || !testEmailTarget.trim()) return;
    setSendingTestEmail(true);
    setTestEmailStatus(null);
    try {
      const res = await sendTestTransactionalEmail({
        uid: userRecord.uid,
        to: testEmailTarget.trim(),
        recipientName: userRecord.displayName || userRecord.email,
      });
      if (res.delivered) {
        const msg = `Test email accepted by Resend${res.resendMessageId ? ` (ID: ${res.resendMessageId})` : ''}. Check ${testEmailTarget.trim()} inbox/spam.`;
        setTestEmailStatus({ ok: true, text: msg });
        notify('Test email sent', msg, 'success');
      } else {
        const reason = formatEmailDeliveryFailureReason(res) || 'Resend rejected or skipped the email.';
        setTestEmailStatus({ ok: false, text: reason });
        notify('Test email failed', reason, 'error');
      }
      await loadEmailDiagnostics();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to invoke test email.';
      setTestEmailStatus({ ok: false, text: msg });
      notify('Test email failed', msg, 'error');
    } finally {
      setSendingTestEmail(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form onSubmit={handleSendTestEmail} className="bg-white border border-[#E9E4F5] rounded-2xl p-6 space-y-4">
          <div>
            <h2 className="font-display font-bold text-base text-[#18142C]">Test Live Resend Email Delivery</h2>
            <p className="text-xs text-[#64607D] mt-1">
              Sends a real email through the <span className="font-mono">sendTransactionalEmail</span> Cloud Function and surfaces the exact Resend API or secret error.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="email"
              required
              value={testEmailTarget}
              onChange={(e) => setTestEmailTarget(e.target.value)}
              placeholder="Recipient email address"
              className="flex-1 px-3.5 py-2.5 border border-[#DDD6FE] rounded-xl text-xs text-[#18142C]"
            />
            <button
              type="submit"
              disabled={sendingTestEmail}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold rounded-xl cursor-pointer disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              <span>{sendingTestEmail ? 'Sending...' : 'Send Test Email'}</span>
            </button>
          </div>
          {testEmailStatus && (
            <div
              className={`p-3.5 rounded-xl border text-xs leading-relaxed ${
                testEmailStatus.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              <strong className="block mb-0.5">{testEmailStatus.ok ? 'Delivery Succeeded' : 'Delivery Error'}</strong>
              <span>{testEmailStatus.text}</span>
            </div>
          )}
          <div className="p-3.5 rounded-xl bg-[#FAF9FE] border border-[#E9E4F5] text-[11px] text-[#64607D] space-y-1">
            <div className="font-semibold text-[#18142C]">Required Cloud Functions Configuration</div>
            <p>1. Store your Resend API key in Firebase Secret Manager: <span className="font-mono text-[#6D28D9]">firebase functions:secrets:set RESEND_API_KEY</span></p>
            <p>2. Verify your sending domain in Resend (e.g. <span className="font-mono text-[#6D28D9]">tapnex.in</span>) and configure a matching sender email below (or <span className="font-mono">RESEND_FROM_EMAIL</span>).</p>
          </div>
        </form>

        <form onSubmit={handleSaveSenderConfig} className="bg-white border border-[#E9E4F5] rounded-2xl p-6 space-y-4">
          <div>
            <h2 className="font-display font-bold text-base text-[#18142C]">Resend Sender Identity</h2>
            <p className="text-xs text-[#64607D] mt-1">
              Used as the default sender when <span className="font-mono">RESEND_FROM_EMAIL</span> is not pinned in environment variables. Domain must be verified in Resend.
            </p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-[#64607D] mb-1">Sender Display Name</label>
              <input
                type="text"
                required
                disabled={userRecord?.role !== 'SUPERADMIN'}
                value={senderConfig.fromName}
                onChange={(e) => setSenderConfig({ ...senderConfig, fromName: e.target.value })}
                placeholder="TapNex"
                className="w-full px-3.5 py-2 border border-[#DDD6FE] rounded-xl text-xs text-[#18142C] disabled:bg-[#FAF9FE]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#64607D] mb-1">Verified Sender Email</label>
              <input
                type="email"
                required
                disabled={userRecord?.role !== 'SUPERADMIN'}
                value={senderConfig.fromEmail}
                onChange={(e) => setSenderConfig({ ...senderConfig, fromEmail: e.target.value })}
                placeholder="orders@tapnex.in"
                className="w-full px-3.5 py-2 border border-[#DDD6FE] rounded-xl text-xs font-mono text-[#18142C] disabled:bg-[#FAF9FE]"
              />
            </div>
          </div>
          {userRecord?.role === 'SUPERADMIN' ? (
            <button
              type="submit"
              disabled={savingSenderConfig}
              className="px-4 py-2.5 bg-[#18142C] hover:bg-[#2A2048] text-white text-xs font-semibold rounded-xl cursor-pointer disabled:opacity-50"
            >
              {savingSenderConfig ? 'Saving...' : 'Save Sender Config'}
            </button>
          ) : (
            <p className="text-[11px] text-[#64607D]">Only SuperAdmin can edit the sender identity.</p>
          )}
        </form>
      </div>

      <div className="bg-white border border-[#E9E4F5] rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E9E4F5] flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display font-bold text-base text-[#18142C]">Recent Customer Email Delivery Logs</h2>
            <p className="text-xs text-[#64607D]">Live delivery attempts logged by <span className="font-mono">sendTransactionalEmail</span>.</p>
          </div>
          <button
            type="button"
            disabled={loadingEmailLogs}
            onClick={() => void loadEmailDiagnostics()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[#DDD6FE] rounded-lg text-xs font-semibold text-[#18142C] hover:bg-[#FAF9FE] cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingEmailLogs ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#FAF9FE] border-b border-[#E9E4F5] text-[#64607D]">
              <tr>
                <th className="py-3 px-4">Time</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Recipient</th>
                <th className="py-3 px-4">Template</th>
                <th className="py-3 px-4">Order</th>
                <th className="py-3 px-4">Details / Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0ECF9]">
              {emailLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[#64607D]">
                    No email delivery attempts logged yet.
                  </td>
                </tr>
              ) : (
                emailLogs.map((log) => (
                  <tr key={log.notificationId} className="hover:bg-[#FAF9FE]">
                    <td className="py-3 px-4 font-mono text-[11px] text-[#64607D] whitespace-nowrap">
                      {formatTimestampDate(log.createdAt)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                          log.deliveryStatus === 'Sent'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : log.deliveryStatus === 'ConfigRequired'
                              ? 'bg-amber-50 text-amber-800 border border-amber-200'
                              : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {log.deliveryStatus}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-[#18142C]">{log.recipientEmail || '—'}</td>
                    <td className="py-3 px-4 font-mono text-[#6D28D9]">{log.templateId || '—'}</td>
                    <td className="py-3 px-4 font-mono text-[11px] text-[#64607D]">{log.orderId || '—'}</td>
                    <td className="py-3 px-4 text-[#64607D] max-w-md break-words">
                      {log.error ? (
                        <span className="text-rose-700 font-medium">{log.error}</span>
                      ) : log.resendMessageId ? (
                        <span className="font-mono text-emerald-700">Resend ID: {log.resendMessageId}</span>
                      ) : (
                        log.message
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const EmailTemplatesManagementPanel: React.FC = () => {
  const { userRecord } = useAuth();
  const { notify } = useToast();
  const [templates, setTemplates] = useState<EmailTemplateRecord[]>([]);
  const [selectedTpl, setSelectedTpl] = useState<EmailTemplateRecord | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getEmailTemplates().then((list) => {
      setTemplates(list);
      setSelectedTpl((prev) =>
        prev ? list.find((item) => item.templateId === prev.templateId) || list[0] || null : list[0] || null
      );
    });
  }, []);

  if (!selectedTpl) {
    return (
      <div className="bg-white border border-[#E9E4F5] rounded-2xl p-6 text-xs text-[#64607D]">
        Loading email templates...
      </div>
    );
  }

  return (
    <div className="bg-white border border-[#E9E4F5] rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-[#7C3AED]" />
        <h2 className="font-display font-bold text-base text-[#18142C]">Transactional Email Templates</h2>
      </div>
      <select
        value={selectedTpl.templateId}
        onChange={(e) => setSelectedTpl(templates.find((t) => t.templateId === e.target.value) || null)}
        className="px-3 py-2 border border-[#DDD6FE] rounded-lg text-xs bg-white text-[#18142C]"
      >
        {templates.map((t) => (
          <option key={t.templateId} value={t.templateId}>{t.name}</option>
        ))}
      </select>
      <input
        type="text"
        value={selectedTpl.subject}
        onChange={(e) => setSelectedTpl({ ...selectedTpl, subject: e.target.value })}
        className="w-full px-3 py-2 border border-[#DDD6FE] rounded-lg text-xs text-[#18142C]"
      />
      <textarea
        rows={8}
        value={selectedTpl.htmlBody}
        onChange={(e) => setSelectedTpl({ ...selectedTpl, htmlBody: e.target.value })}
        className="w-full px-3 py-2 border border-[#DDD6FE] rounded-lg text-xs font-mono text-[#18142C]"
      />
      {userRecord?.role === 'SUPERADMIN' ? (
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await saveEmailTemplate(selectedTpl, {
                uid: userRecord.uid,
                email: userRecord.email,
                role: userRecord.role,
              });
              setTemplates((prev) =>
                prev.map((item) => (item.templateId === selectedTpl.templateId ? selectedTpl : item))
              );
              notify('Email template saved', selectedTpl.name, 'success');
            } finally {
              setSaving(false);
            }
          }}
          className="px-4 py-2 bg-[#18142C] hover:bg-[#2A2048] text-white text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Email Template'}
        </button>
      ) : (
        <p className="text-[11px] text-[#64607D]">Only SuperAdmin can save changes to transactional email templates.</p>
      )}
    </div>
  );
};

export const SupportTicketsManagementPanel: React.FC<{
  onTicketsCountChange?: (count: number) => void;
}> = ({ onTicketsCountChange }) => {
  const { notify } = useToast();
  const [tickets, setTickets] = useState<SupportTicketRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'Open' | 'In Progress' | 'Resolved'>('ALL');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  const loadTickets = async () => {
    setLoading(true);
    try {
      const list = await getSupportTickets();
      setTickets(list);
      onTicketsCountChange?.(list.length);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTickets();
  }, []);

  const filteredTickets =
    statusFilter === 'ALL' ? tickets : tickets.filter((t) => t.status === statusFilter);

  return (
    <div className="bg-white border border-[#E9E4F5] rounded-2xl p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LifeBuoy className="h-4 w-4 text-[#7C3AED]" />
          <h2 className="font-display font-bold text-base text-[#18142C]">
            Customer Support Tickets ({tickets.length})
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['ALL', 'Open', 'In Progress', 'Resolved'] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                statusFilter === status
                  ? 'bg-[#7C3AED] text-white border-[#7C3AED]'
                  : 'bg-[#FAF9FE] text-[#64607D] border-[#E9E4F5] hover:text-[#18142C]'
              }`}
            >
              {status === 'ALL' ? 'All' : status}
            </button>
          ))}
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadTickets()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[#DDD6FE] rounded-lg text-xs font-semibold text-[#18142C] hover:bg-[#FAF9FE] cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {filteredTickets.length === 0 ? (
        <p className="text-xs text-[#64607D] py-6 text-center">
          No support tickets logged{statusFilter !== 'ALL' ? ` with status "${statusFilter}"` : ''}.
        </p>
      ) : (
        <div className="space-y-3">
          {filteredTickets.map((t) => {
            const draftReply = replyDrafts[t.ticketId] ?? t.adminReply ?? '';
            return (
              <div key={t.ticketId} className="p-4 border border-[#E9E4F5] rounded-xl space-y-2.5 bg-[#FAF9FE]/40">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#64607D]">
                  <span>
                    {t.category} · UID: <span className="font-mono">{t.uid.slice(0, 8)}</span>
                    {t.orderId ? ` · Order: ${t.orderId}` : ''}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                      t.status === 'Resolved'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : t.status === 'In Progress'
                          ? 'bg-amber-50 text-amber-800 border border-amber-200'
                          : 'bg-[#F3EEFF] text-[#6D28D9] border border-[#DDD6FE]'
                    }`}
                  >
                    {t.status}
                  </span>
                </div>
                <div className="font-semibold text-sm text-[#18142C]">{t.subject}</div>
                <p className="text-xs text-[#64607D] leading-relaxed">{t.message}</p>
                <div className="pt-1 flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={draftReply}
                    onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [t.ticketId]: e.target.value }))}
                    placeholder="Admin / Support response note..."
                    className="flex-1 px-3 py-1.5 border border-[#DDD6FE] rounded-lg bg-white text-xs text-[#18142C]"
                  />
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={async () => {
                        await updateSupportTicket(t.ticketId, {
                          status: 'In Progress',
                          adminReply: draftReply.trim() || 'Reviewed by support team; working on resolution.',
                        });
                        notify('Ticket updated', `${t.subject} marked In Progress`, 'info');
                        await loadTickets();
                      }}
                      className="px-3 py-1.5 border border-[#DDD6FE] bg-white hover:bg-[#F3EEFF] text-[#18142C] text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Mark In Progress
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await updateSupportTicket(t.ticketId, {
                          status: 'Resolved',
                          adminReply: draftReply.trim() || 'Reviewed and resolved by support team.',
                        });
                        notify('Ticket resolved', t.subject, 'success');
                        await loadTickets();
                      }}
                      className="px-3 py-1.5 bg-[#18142C] hover:bg-[#2A2048] text-white text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Mark Resolved
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
