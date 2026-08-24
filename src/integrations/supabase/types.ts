export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activities: {
        Row: {
          body: string | null
          company_id: string | null
          completed_at: string | null
          contact_id: string | null
          created_at: string | null
          deal_id: string | null
          due_date: string | null
          id: string
          org_id: string
          title: string
          type: Database["public"]["Enums"]["activity_type"]
          user_id: string | null
        }
        Insert: {
          body?: string | null
          company_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          due_date?: string | null
          id?: string
          org_id: string
          title: string
          type: Database["public"]["Enums"]["activity_type"]
          user_id?: string | null
        }
        Update: {
          body?: string | null
          company_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          due_date?: string | null
          id?: string
          org_id?: string
          title?: string
          type?: Database["public"]["Enums"]["activity_type"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          org_id: string
          request_count: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name?: string
          org_id: string
          request_count?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          org_id?: string
          request_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: string | null
          new_values: Json | null
          old_values: Json | null
          org_id: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: string | null
          new_values?: Json | null
          old_values?: Json | null
          org_id: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: string | null
          new_values?: Json | null
          old_values?: Json | null
          org_id?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_logs: {
        Row: {
          actions_result: Json | null
          automation_id: string
          duration_ms: number | null
          error_message: string | null
          executed_at: string | null
          id: string
          org_id: string
          status: string
          trigger_payload: Json | null
        }
        Insert: {
          actions_result?: Json | null
          automation_id: string
          duration_ms?: number | null
          error_message?: string | null
          executed_at?: string | null
          id?: string
          org_id: string
          status?: string
          trigger_payload?: Json | null
        }
        Update: {
          actions_result?: Json | null
          automation_id?: string
          duration_ms?: number | null
          error_message?: string | null
          executed_at?: string | null
          id?: string
          org_id?: string
          status?: string
          trigger_payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_logs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          actions: Json
          conditions: Json | null
          created_at: string | null
          created_by: string | null
          description: string | null
          error_count: number | null
          id: string
          is_active: boolean | null
          last_run_at: string | null
          name: string
          org_id: string
          run_count: number | null
          trigger: Json
          updated_at: string | null
        }
        Insert: {
          actions?: Json
          conditions?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          error_count?: number | null
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          name: string
          org_id: string
          run_count?: number | null
          trigger?: Json
          updated_at?: string | null
        }
        Update: {
          actions?: Json
          conditions?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          error_count?: number | null
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          name?: string
          org_id?: string
          run_count?: number | null
          trigger?: Json
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string | null
          domain: string | null
          id: string
          industry: string | null
          linkedin_url: string | null
          name: string
          org_id: string
          owner_id: string | null
          revenue: number | null
          size: string | null
          updated_at: string | null
          website: string | null
        }
        Insert: {
          created_at?: string | null
          domain?: string | null
          id?: string
          industry?: string | null
          linkedin_url?: string | null
          name: string
          org_id: string
          owner_id?: string | null
          revenue?: number | null
          size?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          created_at?: string | null
          domain?: string | null
          id?: string
          industry?: string | null
          linkedin_url?: string | null
          name?: string
          org_id?: string
          owner_id?: string | null
          revenue?: number | null
          size?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_tags: {
        Row: {
          contact_id: string
          tag_id: string
        }
        Insert: {
          contact_id: string
          tag_id: string
        }
        Update: {
          contact_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          avatar_url: string | null
          company_id: string | null
          created_at: string | null
          disqualified_at: string | null
          email: string | null
          first_name: string
          id: string
          last_name: string | null
          lead_score: number | null
          lifecycle_changed_at: string
          lifecycle_stage: Database["public"]["Enums"]["lifecycle_stage"]
          linkedin_url: string | null
          metadata: Json
          org_id: string
          owner_id: string | null
          phone: string | null
          qualified_at: string | null
          qualified_by: string | null
          status: Database["public"]["Enums"]["contact_status"] | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string | null
          disqualified_at?: string | null
          email?: string | null
          first_name: string
          id?: string
          last_name?: string | null
          lead_score?: number | null
          lifecycle_changed_at?: string
          lifecycle_stage?: Database["public"]["Enums"]["lifecycle_stage"]
          linkedin_url?: string | null
          metadata?: Json
          org_id: string
          owner_id?: string | null
          phone?: string | null
          qualified_at?: string | null
          qualified_by?: string | null
          status?: Database["public"]["Enums"]["contact_status"] | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string | null
          disqualified_at?: string | null
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string | null
          lead_score?: number | null
          lifecycle_changed_at?: string
          lifecycle_stage?: Database["public"]["Enums"]["lifecycle_stage"]
          linkedin_url?: string | null
          metadata?: Json
          org_id?: string
          owner_id?: string | null
          phone?: string | null
          qualified_at?: string | null
          qualified_by?: string | null
          status?: Database["public"]["Enums"]["contact_status"] | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_field_definitions: {
        Row: {
          created_at: string | null
          entity_type: string
          field_key: string
          field_label: string
          field_order: number | null
          field_type: string
          id: string
          is_required: boolean | null
          options: Json | null
          org_id: string
          show_in_card: boolean | null
          show_in_table: boolean | null
        }
        Insert: {
          created_at?: string | null
          entity_type: string
          field_key: string
          field_label: string
          field_order?: number | null
          field_type: string
          id?: string
          is_required?: boolean | null
          options?: Json | null
          org_id: string
          show_in_card?: boolean | null
          show_in_table?: boolean | null
        }
        Update: {
          created_at?: string | null
          entity_type?: string
          field_key?: string
          field_label?: string
          field_order?: number | null
          field_type?: string
          id?: string
          is_required?: boolean | null
          options?: Json | null
          org_id?: string
          show_in_card?: boolean | null
          show_in_table?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_field_definitions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_tags: {
        Row: {
          deal_id: string
          tag_id: string
        }
        Insert: {
          deal_id: string
          tag_id: string
        }
        Update: {
          deal_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_tags_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          close_date: string | null
          company_id: string | null
          contact_id: string | null
          created_at: string | null
          currency: string | null
          id: string
          loss_reason: string | null
          org_id: string
          owner_id: string | null
          probability: number | null
          qualification: Json | null
          qualification_score: number | null
          stage_id: string | null
          status: Database["public"]["Enums"]["deal_status"] | null
          title: string
          updated_at: string | null
          value: number | null
        }
        Insert: {
          close_date?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          currency?: string | null
          id?: string
          loss_reason?: string | null
          org_id: string
          owner_id?: string | null
          probability?: number | null
          qualification?: Json | null
          qualification_score?: number | null
          stage_id?: string | null
          status?: Database["public"]["Enums"]["deal_status"] | null
          title: string
          updated_at?: string | null
          value?: number | null
        }
        Update: {
          close_date?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          currency?: string | null
          id?: string
          loss_reason?: string | null
          org_id?: string
          owner_id?: string | null
          probability?: number | null
          qualification?: Json | null
          qualification_score?: number | null
          stage_id?: string | null
          status?: Database["public"]["Enums"]["deal_status"] | null
          title?: string
          updated_at?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      email_connections: {
        Row: {
          connected_at: string | null
          email_address: string
          from_name: string | null
          id: string
          daily_send_limit: number
          invalid_reason: string | null
          invalid_since: string | null
          is_active: boolean | null
          label: string
          last_synced_at: string | null
          org_id: string
          provider: string
          purpose: string
          scope_type: string
          sent_today: number
          sent_today_date: string | null
          signature_html: string | null
          user_id: string
        }
        Insert: {
          connected_at?: string | null
          daily_send_limit?: number
          email_address: string
          from_name?: string | null
          id?: string
          invalid_reason?: string | null
          invalid_since?: string | null
          is_active?: boolean | null
          label?: string
          last_synced_at?: string | null
          org_id: string
          provider: string
          purpose?: string
          scope_type?: string
          sent_today?: number
          sent_today_date?: string | null
          signature_html?: string | null
          user_id: string
        }
        Update: {
          connected_at?: string | null
          daily_send_limit?: number
          email_address?: string
          from_name?: string | null
          id?: string
          invalid_reason?: string | null
          invalid_since?: string | null
          is_active?: boolean | null
          label?: string
          last_synced_at?: string | null
          org_id?: string
          provider?: string
          purpose?: string
          scope_type?: string
          sent_today?: number
          sent_today_date?: string | null
          signature_html?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sequence_enrollments: {
        Row: {
          completed_at: string | null
          contact_id: string
          current_step: number | null
          enrolled_at: string | null
          id: string
          next_send_at: string | null
          org_id: string
          sequence_id: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          contact_id: string
          current_step?: number | null
          enrolled_at?: string | null
          id?: string
          next_send_at?: string | null
          org_id: string
          sequence_id: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          contact_id?: string
          current_step?: number | null
          enrolled_at?: string | null
          id?: string
          next_send_at?: string | null
          org_id?: string
          sequence_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_sequence_enrollments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sequence_enrollments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sequence_enrollments_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "email_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sequence_steps: {
        Row: {
          body_html: string | null
          created_at: string | null
          delay_days: number
          id: string
          org_id: string
          sequence_id: string
          step_order: number
          subject: string | null
          template_id: string | null
        }
        Insert: {
          body_html?: string | null
          created_at?: string | null
          delay_days?: number
          id?: string
          org_id: string
          sequence_id: string
          step_order?: number
          subject?: string | null
          template_id?: string | null
        }
        Update: {
          body_html?: string | null
          created_at?: string | null
          delay_days?: number
          id?: string
          org_id?: string
          sequence_id?: string
          step_order?: number
          subject?: string | null
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_sequence_steps_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sequence_steps_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "email_sequences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sequence_steps_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sequences: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          org_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          org_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          org_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_sequences_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_signatures: {
        Row: {
          created_at: string | null
          html: string
          id: string
          is_default: boolean | null
          name: string
          org_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          html?: string
          id?: string
          is_default?: boolean | null
          name?: string
          org_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          html?: string
          id?: string
          is_default?: boolean | null
          name?: string
          org_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_signatures_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body_html: string
          category: string | null
          created_at: string | null
          created_by: string | null
          id: string
          name: string
          org_id: string
          subject: string
          updated_at: string | null
          variables: Json | null
        }
        Insert: {
          body_html?: string
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          name: string
          org_id: string
          subject: string
          updated_at?: string | null
          variables?: Json | null
        }
        Update: {
          body_html?: string
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          name?: string
          org_id?: string
          subject?: string
          updated_at?: string | null
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      emails: {
        Row: {
          attachments: Json
          bcc_emails: Json | null
          body_html: string | null
          cc_emails: Json | null
          click_count: number | null
          company_id: string | null
          connection_id: string | null
          contact_id: string | null
          created_at: string | null
          deal_id: string | null
          direction: string
          from_email: string | null
          id: string
          importance: string | null
          is_archived: boolean | null
          is_read: boolean | null
          is_spam: boolean
          is_starred: boolean
          is_trashed: boolean
          last_clicked_at: string | null
          last_opened_at: string | null
          message_id: string | null
          open_count: number | null
          org_id: string
          provider: string | null
          sent_at: string | null
          snoozed_until: string | null
          status: string
          subject: string | null
          synced_from: string | null
          thread_id: string | null
          to_emails: Json | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          attachments?: Json
          bcc_emails?: Json | null
          body_html?: string | null
          cc_emails?: Json | null
          click_count?: number | null
          company_id?: string | null
          connection_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          direction?: string
          from_email?: string | null
          id?: string
          importance?: string | null
          is_archived?: boolean | null
          is_read?: boolean | null
          is_spam?: boolean
          is_starred?: boolean
          is_trashed?: boolean
          last_clicked_at?: string | null
          last_opened_at?: string | null
          message_id?: string | null
          open_count?: number | null
          org_id: string
          provider?: string | null
          sent_at?: string | null
          snoozed_until?: string | null
          status?: string
          subject?: string | null
          synced_from?: string | null
          thread_id?: string | null
          to_emails?: Json | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          attachments?: Json
          bcc_emails?: Json | null
          body_html?: string | null
          cc_emails?: Json | null
          click_count?: number | null
          company_id?: string | null
          connection_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          direction?: string
          from_email?: string | null
          id?: string
          importance?: string | null
          is_archived?: boolean | null
          is_read?: boolean | null
          is_spam?: boolean
          is_starred?: boolean
          is_trashed?: boolean
          last_clicked_at?: string | null
          last_opened_at?: string | null
          message_id?: string | null
          open_count?: number | null
          org_id?: string
          provider?: string | null
          sent_at?: string | null
          snoozed_until?: string | null
          status?: string
          subject?: string | null
          synced_from?: string | null
          thread_id?: string | null
          to_emails?: Json | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "emails_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emails_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emails_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emails_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gmail_oauth_tokens: {
        Row: {
          access_token: string
          created_at: string
          email: string
          expires_at: string
          id: string
          org_id: string
          refresh_token: string
          scope: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          email: string
          expires_at: string
          id?: string
          org_id: string
          refresh_token: string
          scope?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          org_id?: string
          refresh_token?: string
          scope?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      google_oauth_secrets: {
        Row: {
          client_id: string
          client_secret: string
          id: string
          org_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_id: string
          client_secret: string
          id?: string
          org_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          client_secret?: string
          id?: string
          org_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "google_oauth_secrets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_configs: {
        Row: {
          config: Json
          connected_at: string | null
          connected_by: string | null
          id: string
          is_active: boolean | null
          org_id: string
          provider: string
        }
        Insert: {
          config?: Json
          connected_at?: string | null
          connected_by?: string | null
          id?: string
          is_active?: boolean | null
          org_id: string
          provider: string
        }
        Update: {
          config?: Json
          connected_at?: string | null
          connected_by?: string | null
          id?: string
          is_active?: boolean | null
          org_id?: string
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_configs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string | null
          email: string
          id: string
          invited_by: string | null
          org_id: string
          role: Database["public"]["Enums"]["app_role"] | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string | null
          email: string
          id?: string
          invited_by?: string | null
          org_id: string
          role?: Database["public"]["Enums"]["app_role"] | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string | null
          email?: string
          id?: string
          invited_by?: string | null
          org_id?: string
          role?: Database["public"]["Enums"]["app_role"] | null
        }
        Relationships: [
          {
            foreignKeyName: "invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_score_history: {
        Row: {
          contact_id: string
          created_at: string | null
          event_type: string | null
          id: string
          org_id: string
          points: number
          reason: string
        }
        Insert: {
          contact_id: string
          created_at?: string | null
          event_type?: string | null
          id?: string
          org_id: string
          points: number
          reason: string
        }
        Update: {
          contact_id?: string
          created_at?: string | null
          event_type?: string | null
          id?: string
          org_id?: string
          points?: number
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_score_history_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_score_history_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_scoring_rules: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          is_active: boolean | null
          label: string
          org_id: string
          points: number
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          is_active?: boolean | null
          label: string
          org_id: string
          points?: number
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          is_active?: boolean | null
          label?: string
          org_id?: string
          points?: number
        }
        Relationships: [
          {
            foreignKeyName: "lead_scoring_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      loss_reasons: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          label: string
          org_id: string
          usage_count: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          label: string
          org_id: string
          usage_count?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          label?: string
          org_id?: string
          usage_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "loss_reasons_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_ad_accounts: {
        Row: {
          account_status: number | null
          business_id: string | null
          business_name: string | null
          created_at: string | null
          currency: string | null
          id: string
          is_default: boolean | null
          meta_account_id: string
          name: string
          org_id: string
          timezone_name: string | null
          updated_at: string | null
        }
        Insert: {
          account_status?: number | null
          business_id?: string | null
          business_name?: string | null
          created_at?: string | null
          currency?: string | null
          id?: string
          is_default?: boolean | null
          meta_account_id: string
          name: string
          org_id: string
          timezone_name?: string | null
          updated_at?: string | null
        }
        Update: {
          account_status?: number | null
          business_id?: string | null
          business_name?: string | null
          created_at?: string | null
          currency?: string | null
          id?: string
          is_default?: boolean | null
          meta_account_id?: string
          name?: string
          org_id?: string
          timezone_name?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      meta_ads: {
        Row: {
          adset_id: string
          creative_id: string | null
          id: string
          meta_ad_id: string
          name: string
          org_id: string
          raw: Json | null
          status: string | null
          synced_at: string | null
        }
        Insert: {
          adset_id: string
          creative_id?: string | null
          id?: string
          meta_ad_id: string
          name: string
          org_id: string
          raw?: Json | null
          status?: string | null
          synced_at?: string | null
        }
        Update: {
          adset_id?: string
          creative_id?: string | null
          id?: string
          meta_ad_id?: string
          name?: string
          org_id?: string
          raw?: Json | null
          status?: string | null
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_ads_adset_id_fkey"
            columns: ["adset_id"]
            isOneToOne: false
            referencedRelation: "meta_adsets"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_adsets: {
        Row: {
          billing_event: string | null
          campaign_id: string
          daily_budget: number | null
          id: string
          lifetime_budget: number | null
          meta_adset_id: string
          name: string
          optimization_goal: string | null
          org_id: string
          raw: Json | null
          status: string | null
          synced_at: string | null
        }
        Insert: {
          billing_event?: string | null
          campaign_id: string
          daily_budget?: number | null
          id?: string
          lifetime_budget?: number | null
          meta_adset_id: string
          name: string
          optimization_goal?: string | null
          org_id: string
          raw?: Json | null
          status?: string | null
          synced_at?: string | null
        }
        Update: {
          billing_event?: string | null
          campaign_id?: string
          daily_budget?: number | null
          id?: string
          lifetime_budget?: number | null
          meta_adset_id?: string
          name?: string
          optimization_goal?: string | null
          org_id?: string
          raw?: Json | null
          status?: string | null
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_adsets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "meta_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_campaigns: {
        Row: {
          ad_account_id: string
          created_time: string | null
          daily_budget: number | null
          effective_status: string | null
          id: string
          lifetime_budget: number | null
          meta_campaign_id: string
          name: string
          objective: string | null
          org_id: string
          raw: Json | null
          start_time: string | null
          status: string | null
          stop_time: string | null
          synced_at: string | null
          updated_time: string | null
        }
        Insert: {
          ad_account_id: string
          created_time?: string | null
          daily_budget?: number | null
          effective_status?: string | null
          id?: string
          lifetime_budget?: number | null
          meta_campaign_id: string
          name: string
          objective?: string | null
          org_id: string
          raw?: Json | null
          start_time?: string | null
          status?: string | null
          stop_time?: string | null
          synced_at?: string | null
          updated_time?: string | null
        }
        Update: {
          ad_account_id?: string
          created_time?: string | null
          daily_budget?: number | null
          effective_status?: string | null
          id?: string
          lifetime_budget?: number | null
          meta_campaign_id?: string
          name?: string
          objective?: string | null
          org_id?: string
          raw?: Json | null
          start_time?: string | null
          status?: string | null
          stop_time?: string | null
          synced_at?: string | null
          updated_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_campaigns_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "meta_ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_insights: {
        Row: {
          campaign_id: string | null
          clicks: number | null
          conversion_value: number | null
          conversions: number | null
          cpc: number | null
          cpm: number | null
          ctr: number | null
          date_start: string
          date_stop: string
          entity_id: string
          id: string
          impressions: number | null
          level: string
          org_id: string
          raw: Json | null
          reach: number | null
          spend: number | null
          synced_at: string | null
        }
        Insert: {
          campaign_id?: string | null
          clicks?: number | null
          conversion_value?: number | null
          conversions?: number | null
          cpc?: number | null
          cpm?: number | null
          ctr?: number | null
          date_start: string
          date_stop: string
          entity_id: string
          id?: string
          impressions?: number | null
          level: string
          org_id: string
          raw?: Json | null
          reach?: number | null
          spend?: number | null
          synced_at?: string | null
        }
        Update: {
          campaign_id?: string | null
          clicks?: number | null
          conversion_value?: number | null
          conversions?: number | null
          cpc?: number | null
          cpm?: number | null
          ctr?: number | null
          date_start?: string
          date_stop?: string
          entity_id?: string
          id?: string
          impressions?: number | null
          level?: string
          org_id?: string
          raw?: Json | null
          reach?: number | null
          spend?: number | null
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_insights_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "meta_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_sync_log: {
        Row: {
          duration_ms: number | null
          error_message: string | null
          finished_at: string | null
          id: string
          org_id: string
          records_synced: number | null
          started_at: string | null
          status: string
          sync_type: string
        }
        Insert: {
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          org_id: string
          records_synced?: number | null
          started_at?: string | null
          status: string
          sync_type: string
        }
        Update: {
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          org_id?: string
          records_synced?: number | null
          started_at?: string | null
          status?: string
          sync_type?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          daily_summary: boolean | null
          daily_summary_hour: number | null
          email_daily_summary: boolean | null
          email_deal_won: boolean | null
          email_task_overdue: boolean | null
          id: string
          notify_assignment: boolean | null
          notify_deal_lost: boolean | null
          notify_deal_won: boolean | null
          notify_mention: boolean | null
          notify_task_overdue: boolean | null
          org_id: string
          user_id: string
        }
        Insert: {
          daily_summary?: boolean | null
          daily_summary_hour?: number | null
          email_daily_summary?: boolean | null
          email_deal_won?: boolean | null
          email_task_overdue?: boolean | null
          id?: string
          notify_assignment?: boolean | null
          notify_deal_lost?: boolean | null
          notify_deal_won?: boolean | null
          notify_mention?: boolean | null
          notify_task_overdue?: boolean | null
          org_id: string
          user_id: string
        }
        Update: {
          daily_summary?: boolean | null
          daily_summary_hour?: number | null
          email_daily_summary?: boolean | null
          email_deal_won?: boolean | null
          email_task_overdue?: boolean | null
          id?: string
          notify_assignment?: boolean | null
          notify_deal_lost?: boolean | null
          notify_deal_won?: boolean | null
          notify_mention?: boolean | null
          notify_task_overdue?: boolean | null
          org_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_progress: {
        Row: {
          completed: boolean | null
          contact_created: boolean | null
          created_at: string | null
          deal_created: boolean | null
          demo_loaded: boolean | null
          dismissed_at: string | null
          email_connected: boolean | null
          id: string
          member_invited: boolean | null
          org_id: string
          pipeline_created: boolean | null
          profile_configured: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          completed?: boolean | null
          contact_created?: boolean | null
          created_at?: string | null
          deal_created?: boolean | null
          demo_loaded?: boolean | null
          dismissed_at?: string | null
          email_connected?: boolean | null
          id?: string
          member_invited?: boolean | null
          org_id: string
          pipeline_created?: boolean | null
          profile_configured?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          completed?: boolean | null
          contact_created?: boolean | null
          created_at?: string | null
          deal_created?: boolean | null
          demo_loaded?: boolean | null
          dismissed_at?: string | null
          email_connected?: boolean | null
          id?: string
          member_invited?: boolean | null
          org_id?: string
          pipeline_created?: boolean | null
          profile_configured?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_progress_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_secrets: {
        Row: {
          created_at: string | null
          id: string
          key_name: string
          key_value: string
          org_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          key_name: string
          key_value: string
          org_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          key_name?: string
          key_value?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_secrets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string | null
          id: string
          name: string
          plan: string | null
          settings: Json | null
          slug: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          plan?: string | null
          settings?: Json | null
          slug: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          plan?: string | null
          settings?: Json | null
          slug?: string
        }
        Relationships: []
      }
      pipeline_stages: {
        Row: {
          color: string | null
          created_at: string | null
          id: string
          name: string
          order: number
          org_id: string
          pipeline_id: string
          win_probability: number | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          id?: string
          name: string
          order?: number
          org_id: string
          pipeline_id: string
          win_probability?: number | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          id?: string
          name?: string
          order?: number
          org_id?: string
          pipeline_id?: string
          win_probability?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      pipelines: {
        Row: {
          created_at: string | null
          currency: string | null
          id: string
          is_default: boolean | null
          name: string
          org_id: string
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          org_id: string
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipelines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string | null
          id: string
          name: string | null
          onboarding_completed: boolean | null
          onboarding_step: number | null
          org_id: string | null
          timezone: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          id: string
          name?: string | null
          onboarding_completed?: boolean | null
          onboarding_step?: number | null
          org_id?: string | null
          timezone?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string | null
          onboarding_completed?: boolean | null
          onboarding_step?: number | null
          org_id?: string | null
          timezone?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_rules: {
        Row: {
          applies_to: string
          created_at: string | null
          id: string
          is_active: boolean | null
          metric: string
          name: string
          org_id: string
          risk_level: string
          threshold_days: number
        }
        Insert: {
          applies_to?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          metric?: string
          name: string
          org_id: string
          risk_level?: string
          threshold_days?: number
        }
        Update: {
          applies_to?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          metric?: string
          name?: string
          org_id?: string
          risk_level?: string
          threshold_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "risk_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          allowed: boolean
          created_at: string | null
          id: string
          org_id: string
          permission: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          allowed?: boolean
          created_at?: string | null
          id?: string
          org_id: string
          permission: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          allowed?: boolean
          created_at?: string | null
          id?: string
          org_id?: string
          permission?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_goals: {
        Row: {
          assign_type: string
          created_at: string | null
          created_by: string | null
          current_value: number
          goal_type: string
          id: string
          org_id: string
          period_month: number
          period_year: number
          target_value: number
          team_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          assign_type?: string
          created_at?: string | null
          created_by?: string | null
          current_value?: number
          goal_type?: string
          id?: string
          org_id: string
          period_month: number
          period_year: number
          target_value?: number
          team_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          assign_type?: string
          created_at?: string | null
          created_by?: string | null
          current_value?: number
          goal_type?: string
          id?: string
          org_id?: string
          period_month?: number
          period_year?: number
          target_value?: number
          team_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_goals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_goals_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      segments: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          filters: Json
          id: string
          name: string
          org_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          filters?: Json
          id?: string
          name: string
          org_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          filters?: Json
          id?: string
          name?: string
          org_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "segments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string | null
          id: string
          name: string
          org_id: string
        }
        Insert: {
          color?: string | null
          id?: string
          name: string
          org_id: string
        }
        Update: {
          color?: string | null
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          joined_at: string | null
          team_id: string
          user_id: string
        }
        Insert: {
          joined_at?: string | null
          team_id: string
          user_id: string
        }
        Update: {
          joined_at?: string | null
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          org_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          org_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tracking_events: {
        Row: {
          contact_id: string | null
          created_at: string | null
          event_type: string
          id: string
          metadata: Json | null
          org_id: string
          page_title: string | null
          page_url: string | null
          referrer: string | null
          visitor_id: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          org_id: string
          page_title?: string | null
          page_url?: string | null
          referrer?: string | null
          visitor_id?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          org_id?: string
          page_title?: string | null
          page_url?: string | null
          referrer?: string | null
          visitor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tracking_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracking_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          org_id: string
          receives_leads: boolean
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          org_id: string
          receives_leads?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          org_id?: string
          receives_leads?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks: {
        Row: {
          created_at: string | null
          events: string[]
          failure_count: number | null
          id: string
          is_active: boolean | null
          last_triggered_at: string | null
          name: string
          org_id: string
          secret: string | null
          url: string
        }
        Insert: {
          created_at?: string | null
          events?: string[]
          failure_count?: number | null
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          name: string
          org_id: string
          secret?: string | null
          url: string
        }
        Update: {
          created_at?: string | null
          events?: string[]
          failure_count?: number | null
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          name?: string
          org_id?: string
          secret?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_business_accounts: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          org_id: string
          provider: string
          server_url: string | null
          updated_at: string
          waba_id: string | null
          webhook_verify_token: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          org_id: string
          provider?: string
          server_url?: string | null
          updated_at?: string
          waba_id?: string | null
          webhook_verify_token: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          org_id?: string
          provider?: string
          server_url?: string | null
          updated_at?: string
          waba_id?: string | null
          webhook_verify_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_business_accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_connections: {
        Row: {
          connected_at: string
          daily_send_limit: number
          display_phone_number: string | null
          id: string
          instance_name: string | null
          is_active: boolean
          label: string
          org_id: string
          phone_number_id: string
          provider: string
          scope_type: string
          sent_today: number
          sent_today_date: string | null
          user_id: string
          verified_name: string | null
          waba_id: string | null
        }
        Insert: {
          connected_at?: string
          daily_send_limit?: number
          display_phone_number?: string | null
          id?: string
          instance_name?: string | null
          is_active?: boolean
          label?: string
          org_id: string
          phone_number_id: string
          provider?: string
          scope_type?: string
          sent_today?: number
          sent_today_date?: string | null
          user_id: string
          verified_name?: string | null
          waba_id?: string | null
        }
        Update: {
          connected_at?: string
          daily_send_limit?: number
          display_phone_number?: string | null
          id?: string
          instance_name?: string | null
          is_active?: boolean
          label?: string
          org_id?: string
          phone_number_id?: string
          provider?: string
          scope_type?: string
          sent_today?: number
          sent_today_date?: string | null
          user_id?: string
          verified_name?: string | null
          waba_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_config: {
        Row: {
          created_at: string
          display_phone_number: string | null
          id: string
          is_active: boolean
          org_id: string
          phone_number_id: string
          updated_at: string
          verified_name: string | null
          waba_id: string
          webhook_verify_token: string
        }
        Insert: {
          created_at?: string
          display_phone_number?: string | null
          id?: string
          is_active?: boolean
          org_id: string
          phone_number_id: string
          updated_at?: string
          verified_name?: string | null
          waba_id: string
          webhook_verify_token: string
        }
        Update: {
          created_at?: string
          display_phone_number?: string | null
          id?: string
          is_active?: boolean
          org_id?: string
          phone_number_id?: string
          updated_at?: string
          verified_name?: string | null
          waba_id?: string
          webhook_verify_token?: string
        }
        Relationships: []
      }
      whatsapp_messages: {
        Row: {
          body: string | null
          connection_id: string | null
          contact_id: string | null
          created_at: string
          deal_id: string | null
          direction: string
          error_message: string | null
          from_number: string
          id: string
          message_type: string
          org_id: string
          raw: Json | null
          status: string
          to_number: string
          user_id: string | null
          wa_message_id: string | null
        }
        Insert: {
          body?: string | null
          connection_id?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          direction: string
          error_message?: string | null
          from_number: string
          id?: string
          message_type?: string
          org_id: string
          raw?: Json | null
          status?: string
          to_number: string
          user_id?: string | null
          wa_message_id?: string | null
        }
        Update: {
          body?: string | null
          connection_id?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          direction?: string
          error_message?: string | null
          from_number?: string
          id?: string
          message_type?: string
          org_id?: string
          raw?: Json | null
          status?: string
          to_number?: string
          user_id?: string | null
          wa_message_id?: string | null
        }
        Relationships: []
      }
      whatsapp_secrets: {
        Row: {
          access_token: string
          id: string
          org_id: string
          updated_at: string
        }
        Insert: {
          access_token: string
          id?: string
          org_id: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          id?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_secrets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_templates: {
        Row: {
          category: string | null
          components: Json | null
          id: string
          language: string
          name: string
          org_id: string
          status: string | null
          synced_at: string
        }
        Insert: {
          category?: string | null
          components?: Json | null
          id?: string
          language?: string
          name: string
          org_id: string
          status?: string | null
          synced_at?: string
        }
        Update: {
          category?: string | null
          components?: Json | null
          id?: string
          language?: string
          name?: string
          org_id?: string
          status?: string | null
          synced_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_pending_invitation: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      create_organization_for_user: {
        Args: {
          p_name: string
          p_settings?: Json
          p_slug: string
          p_user_id: string
        }
        Returns: string
      }
      get_user_org_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _org_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      gmail_invalidar_conexoes: {
        Args: { _motivo: string; _org_id: string }
        Returns: number
      }
      initialize_org_owner: {
        Args: { p_org_id: string; p_user_id: string }
        Returns: undefined
      }
      is_org_admin: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      next_round_robin_owner: {
        Args: { _org_id: string }
        Returns: string
      }
      reserve_email_send: {
        Args: { _connection_id: string }
        Returns: boolean
      }
      reserve_whatsapp_send: {
        Args: { _connection_id: string }
        Returns: boolean
      }
      sdr_by_channel: {
        Args: { _from?: string; _org_id: string; _to?: string }
        Returns: { canal: string; total: number }[]
      }
      sdr_by_owner: {
        Args: { _from?: string; _org_id: string; _to?: string }
        Returns: {
          abordagens: number
          leads: number
          pessoa: string
          reunioes: number
          vendas: number
        }[]
      }
      sdr_funnel: {
        Args: { _from?: string; _org_id: string; _to?: string }
        Returns: { etapa: string; ordem: number; total: number }[]
      }
      sdr_series: {
        Args: { _from?: string; _org_id: string; _to?: string }
        Returns: {
          abordagens: number
          dia: string
          leads: number
          respostas: number
        }[]
      }
      sdr_metrics: {
        Args: { _from?: string; _org_id: string; _to?: string }
        Returns: {
          abordagens: number
          aguardando_humano: number
          conversas_iniciadas: number
          leads_recebidos: number
          leads_whatsapp: number
          oportunidades: number
          reunioes: number
          taxa_entrega: number | null
          taxa_resposta: number | null
          tempo_resposta_min: number | null
          vendas_sdr: number
        }[]
      }
      sdr_metric_leads: {
        Args: {
          _from?: string
          _limite?: number
          _metric: string
          _org_id: string
          _to?: string
        }
        Returns: {
          detalhe: string | null
          id: string
          quando: string | null
          respondeu: boolean | null
          subtitulo: string | null
          tipo: string
          titulo: string
          toques: number
          valor: number | null
        }[]
      }
      qualify_lead: {
        Args: { p_contact_id: string; p_pipeline_id: string }
        Returns: string
      }
      user_belongs_to_org: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      activity_type: "call" | "email" | "meeting" | "note" | "task"
      app_role: "owner" | "admin" | "member"
      contact_status: "lead" | "prospect" | "customer" | "churned"
      deal_status: "open" | "won" | "lost"
      lifecycle_stage:
        | "lead"
        | "contacted"
        | "qualified"
        | "opportunity"
        | "customer"
        | "disqualified"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_type: ["call", "email", "meeting", "note", "task"],
      app_role: ["owner", "admin", "member"],
      contact_status: ["lead", "prospect", "customer", "churned"],
      deal_status: ["open", "won", "lost"],
      lifecycle_stage: [
        "lead",
        "contacted",
        "qualified",
        "opportunity",
        "customer",
        "disqualified",
      ],
    },
  },
} as const
