import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

interface SendInviteEmailParams {
  toEmail: string;
  householdName: string;
  inviteCode: string;
  inviteLink: string;
  inviterName: string;
}

@Injectable({ providedIn: 'root' })
export class InviteEmailService {
  async sendHouseholdInvite(params: SendInviteEmailParams): Promise<void> {
    const emailjs = environment.emailjs;
    if (!emailjs.serviceId || !emailjs.templateId || !emailjs.publicKey) {
      throw new Error('Email service is not configured.');
    }

    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        service_id: emailjs.serviceId,
        template_id: emailjs.templateId,
        user_id: emailjs.publicKey,
        template_params: {
          to_email: params.toEmail,
          toEmail: params.toEmail,
          email: params.toEmail,
          recipient_email: params.toEmail,
          recipient: params.toEmail,
          household_name: params.householdName,
          householdName: params.householdName,
          invite_code: params.inviteCode,
          inviteCode: params.inviteCode,
          invite_link: params.inviteLink,
          inviteLink: params.inviteLink,
          inviter_name: params.inviterName,
          inviterName: params.inviterName,
          app_name: 'TwoCents',
          appName: 'TwoCents',
          create_account_link: `${window.location.origin}/#/auth?inviteCode=${encodeURIComponent(params.inviteCode)}`,
          invite_message:
            `Create an account or sign in first, then accept or decline this invite in TwoCents. ` +
            `Invite code: ${params.inviteCode}. Join link: ${params.inviteLink}`
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (errorText.includes('recipients address is empty')) {
        throw new Error('Failed to send invite email: EmailJS template recipient is not mapped. Set template To Email to {{to_email}}.');
      }

      throw new Error(`Failed to send invite email: ${errorText || response.statusText}`);
    }
  }
}
