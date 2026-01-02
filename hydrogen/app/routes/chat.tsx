import { json, type LoaderFunctionArgs } from '@shopify/remix-oxygen';
import { useLoaderData } from '@remix-run/react';
import { getCustomerClient } from '../lib/customer.server';
import { getCart } from '../lib/cart.server';
import { CUSTOMER_QUERY } from '../gql/customer';

type LoaderData = {
	customerAccessToken: string | null;
	customer: {
		id: string;
		email: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
	cart: any;
	cartId: string | null;
};

export async function loader({ request, context }: LoaderFunctionArgs) {
	const { env } = context;
	const headers = new Headers();

	// Customer Account API
	let customerAccessToken: string | null = null;
	let customer: LoaderData['customer'] = null;
	try {
		const customerClient = getCustomerClient(env, request);
		customerAccessToken = await customerClient.getAccessToken();
		if (customerAccessToken) {
			const res = await customerClient.query(CUSTOMER_QUERY);
			customer = res.data?.customer ?? null;
		}
	} catch (err) {
		console.error('chat loader: customer fetch failed', err);
	}

	// Cart via Storefront
	let cart: any = null;
	let cartId: string | null = null;
	try {
		const cartResult = await getCart(request, env);
		cart = cartResult.cart;
		cartId = cartResult.cartId;
		if (cartResult.headers) {
			cartResult.headers.forEach((value, key) => headers.append(key, value));
		}
	} catch (err) {
		console.error('chat loader: cart fetch failed', err);
	}

	return json<LoaderData>(
		{
			customerAccessToken,
			customer,
			cart,
			cartId,
		},
		{ headers }
	);
}

export default function ChatPage() {
	const data = useLoaderData<typeof loader>();
	return (
		<main style={{ padding: '1rem', fontFamily: 'sans-serif' }}>
			<h1>Chat context</h1>
			<pre>{JSON.stringify(data, null, 2)}</pre>
		</main>
	);
}
