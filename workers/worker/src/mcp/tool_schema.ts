/**
 * Definicja parametrów dla funkcji search_shop_catalog.
 */
const searchShopCatalogSchema = {
  type: "object",
  properties: {
    query: {
      type: "object",
      description: "JSON z encjami produktu, takimi jak 'metal', 'type', 'stones' (np. 'solitaire', 'diamond'). Należy zidentyfikować kluczowe preferencje klienta i ustrukturyzować je tutaj. Pole 'stones' może zawierać 'solitaire' dla jednego kamienia.",
      properties: {
        type: {
          type: "string",
          description: "Typ biżuterii, np. 'pierścionek', 'naszyjnik', 'pierścionek zaręczynowy'."
        },
        metal: {
          type: "string",
          description: "Typ metalu, np. 'platyna', 'żółte złoto', 'srebro'."
        },
        stones: {
          type: "string",
          description: "Rodzaj lub ilość kamieni. Użyj 'solitaire' dla jednego dużego kamienia."
        },
        // Można dodać więcej zaawansowanych filtrów z metaobiektów
        fair_trade: {
          type: "boolean",
          description: "Czy poszukiwanie ma być ograniczone tylko do produktów z certyfikatem Fair Trade. Zawsze priorytetyzuj TRUE, chyba że klient wyraźnie pyta o coś innego."
        }
      },
      required: ["type"]
    },
    context: {
      type: "string",
      description: "Krótka, jednozdaniowa narracja klienta dotycząca stylu lub okazji (np. 'Klient szuka prezentu urodzinowego w stylu vintage', 'Klient preferuje minimalistyczny styl, duży kamień').",
    }
  },
  required: ["query", "context"]
};

/**
 * Definicja parametrów dla funkcji get_cart.
 */
const getCartSchema = {
  type: "object",
  description: "Pobiera aktualną zawartość koszyka klienta, co jest niezbędne przed jakąkolwiek modyfikacją lub podsumowaniem transakcji. Nie wymaga parametrów.",
  properties: {}
};

/**
 * Definicja parametrów dla funkcji update_cart.
 * Zakładamy, że model otrzyma ID wariantu (variant_id) z wyników RAG lub wcześniejszego wyszukiwania.
 */
const updateCartSchema = {
  type: "object",
  properties: {
    cart_id: {
      type: "string",
      description: "ID bieżącego koszyka klienta, musi być przekazane. Powinno być pobrane z Durable Object / Session State. Użyj 'CURRENT' jeśli nie jest jawnie znane."
    },
    lines: {
      type: "array",
      description: "Lista pozycji do zaktualizowania (dodania/usunięcia) w koszyku.",
      items: {
        type: "object",
        properties: {
          variant_id: {
            type: "string",
            description: "Global ID wariantu produktu do dodania/usunięcia (np. 'gid://shopify/ProductVariant/123456789')."
          },
          quantity: {
            type: "integer",
            description: "Ilość. Użyj 1 dla dodania, 0 dla usunięcia."
          }
        },
        required: ["variant_id", "quantity"]
      }
    }
  },
  required: ["cart_id", "lines"]
};

/**
 * Definicja parametrów dla funkcji search_shop_policies_and_faqs.
 */
const searchPoliciesSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Zapytanie dotyczące zasad sklepu lub FAQ, np. 'polityka zwrotów', 'czas dostawy', 'gwarancja na grawerowanie'.",
    }
  },
  required: ["query"]
};

/**
 * Definicja parametrów dla funkcji get_order_status.
 */
const getOrderStatusSchema = {
  type: "object",
  properties: {
    order_id: {
      type: "string",
      description: "ID zamówienia do sprawdzenia (np. 'gid://shopify/Order/123456789' lub numer zamówienia)."
    }
  },
  required: ["order_id"]
};

/**
 * Definicja parametrów dla funkcji get_most_recent_order_status.
 */
const getMostRecentOrderStatusSchema = {
  type: "object",
  description: "Pobiera status ostatniego zamówienia dla bieżącego klienta. Nie wymaga parametrów.",
  properties: {}
};

/**
 * Generuje pełny schemat narzędzi MCP w formacie JSON zgodnym ze specyfikacją Function Calling/Tool Use.
 * @returns Pełny schemat JSON jako string.
 */
export function generateMcpToolSchema(): string {
  const tools = [
    {
      type: "function",
      function: {
        name: "search_shop_catalog",
        description: "Wyszukuje produkty w katalogu sklepu na podstawie cech produktu i preferencji klienta (metale, kamienie, typy biżuterii). Zwraca ustrukturyzowane wyniki. Używaj tylko do **wyszukiwania** produktów.",
        parameters: searchShopCatalogSchema
      }
    },
    {
      type: "function",
      function: {
        name: "get_cart",
        description: "Pobiera aktualny koszyk klienta. Niezbędne przed podjęciem działań, takich jak dodawanie produktów.",
        parameters: getCartSchema
      }
    },
    {
      type: "function",
      function: {
        name: "update_cart",
        description: "Aktualizuje koszyk klienta (dodaje lub usuwa produkty). Wymaga ID wariantu (variant_id) i ilości.",
        parameters: updateCartSchema
      }
    },
    {
      type: "function",
      function: {
        name: "search_shop_policies_and_faqs",
        description: "Wyszukuje w dokumentacji i politykach sklepu, takich jak zwroty, wysyłka czy gwarancja. Używaj dla pytań o zasady, a nie o produkty.",
        parameters: searchPoliciesSchema
      }
    },
    {
      type: "function",
      function: {
        name: "get_order_status",
        description: "Pobiera status i szczegóły konkretnego zamówienia po jego ID.",
        parameters: getOrderStatusSchema
      }
    },
    {
      type: "function",
      function: {
        name: "get_most_recent_order_status",
        description: "Pobiera status ostatniego zamówienia dla bieżącego klienta.",
        parameters: getMostRecentOrderStatusSchema
      }
    }
  ];

  // Zwracamy string JSON dla łatwego wstrzyknięcia do promptu LLM
  return JSON.stringify(tools, null, 2);
}

// Przykład użycia, pokazujący, jak schemat będzie wyglądał w promptcie:
// const schemaString = generateMcpToolSchema();
// console.log(schemaString);