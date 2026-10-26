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
      invoice_items: {
        Row: {
          discount_percent: number
          id: string
          invoice_id: string
          name: string
          quantity: number
          total_price: number
          unit_price: number
        }
        Insert: {
          discount_percent?: number
          id?: string
          invoice_id: string
          name: string
          quantity: number
          total_price: number
          unit_price: number
        }
        Update: {
          discount_percent?: number
          id?: string
          invoice_id?: string
          name?: string
          quantity?: number
          total_price?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string
          id: string
          invoice_number: string
          payment_method: string
          pos_masked_pan: string | null
          pos_ref_number: string | null
          pos_response_code: string | null
          pos_terminal_id: string | null
          status: string
          total: number
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_number: string
          payment_method: string
          pos_masked_pan?: string | null
          pos_ref_number?: string | null
          pos_response_code?: string | null
          pos_terminal_id?: string | null
          status?: string
          total: number
        }
        Update: {
          created_at?: string
          id?: string
          invoice_number?: string
          payment_method?: string
          pos_masked_pan?: string | null
          pos_ref_number?: string | null
          pos_response_code?: string | null
          pos_terminal_id?: string | null
          status?: string
          total?: number
        }
        Relationships: []
      }
      products: {
        Row: {
          accent: string
          active: boolean
          created_at: string
          description: string
          icon: string
          id: number
          image_url: string | null
          meta: Json
          name: string
          price: number
          section: string
          sort_order: number
          stock: number | null
          updated_at: string
        }
        Insert: {
          accent?: string
          active?: boolean
          created_at?: string
          description?: string
          icon?: string
          id?: number
          image_url?: string | null
          meta?: Json
          name: string
          price?: number
          section: string
          sort_order?: number
          stock?: number | null
          updated_at?: string
        }
        Update: {
          accent?: string
          active?: boolean
          created_at?: string
          description?: string
          icon?: string
          id?: number
          image_url?: string | null
          meta?: Json
          name?: string
          price?: number
          section?: string
          sort_order?: number
          stock?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      survey_responses: {
        Row: {
          comment: string | null
          created_at: string
          environment_rating: number | null
          guide_rating: number | null
          id: string
          overall_rating: number
          visitor_name: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string
          environment_rating?: number | null
          guide_rating?: number | null
          id?: string
          overall_rating: number
          visitor_name?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string
          environment_rating?: number | null
          guide_rating?: number | null
          id?: string
          overall_rating?: number
          visitor_name?: string | null
        }
        Relationships: []
      }
      ticket_types: {
        Row: {
          active: boolean
          base_price: number
          category: string
          created_at: string
          description: string
          group_discount_percent: number
          group_min_count: number
          id: number
          name: string
        }
        Insert: {
          active?: boolean
          base_price: number
          category: string
          created_at?: string
          description?: string
          group_discount_percent?: number
          group_min_count?: number
          id?: number
          name: string
        }
        Update: {
          active?: boolean
          base_price?: number
          category?: string
          created_at?: string
          description?: string
          group_discount_percent?: number
          group_min_count?: number
          id?: number
          name?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
