-- Un pedido cobrado no vuelve a "en espera" y uno cancelado no se reactiva,
-- aunque un dispositivo con una copia vieja (por ejemplo la pantalla de cocina
-- que estuvo apagada, o una caja con una versión vieja de B-POS) lo suba.
-- Se conserva el cobro / la cancelación que ya estaba en la nube.

create or replace function public.sync_orders_keep_money()
returns trigger
language plpgsql
as $$
declare
  k text;
begin
  if new.collection <> 'bpos_orders' or new.deleted or old.data is null or new.data is null then
    return new;
  end if;

  -- Cobrado → "en espera": se queda cobrado
  if coalesce((old.data->>'pendingPayment')::boolean, false) = false
     and coalesce((new.data->>'pendingPayment')::boolean, false) = true
     and coalesce((new.data->>'cancelled')::boolean, false) = false then
    foreach k in array array['pendingPayment', 'paidAt', 'paidBy', 'paidShiftSessionId', 'tip', 'tipPayments', 'partialPayments'] loop
      if old.data ? k then new.data := jsonb_set(new.data, array[k], old.data->k);
      else new.data := new.data - k;
      end if;
    end loop;
    if jsonb_typeof(new.data->'details') = 'object' then
      foreach k in array array['paymentMethod', 'payments', 'couponCode'] loop
        if coalesce(old.data->'details', '{}'::jsonb) ? k then new.data := jsonb_set(new.data, array['details', k], old.data->'details'->k);
        else new.data := new.data #- array['details', k];
        end if;
      end loop;
    end if;
  end if;

  -- Cancelado → activo: se queda cancelado
  if coalesce((old.data->>'cancelled')::boolean, false) = true
     and coalesce((new.data->>'cancelled')::boolean, false) = false then
    foreach k in array array['cancelled', 'cancelledAt', 'cancelledBy', 'cancelReason'] loop
      if old.data ? k then new.data := jsonb_set(new.data, array[k], old.data->k); end if;
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_orders_keep_money on public.sync_records;
create trigger sync_orders_keep_money
  before update on public.sync_records
  for each row execute function public.sync_orders_keep_money();

revoke execute on function public.sync_orders_keep_money() from public, anon;
