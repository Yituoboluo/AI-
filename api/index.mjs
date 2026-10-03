import {waitUntil} from '@vercel/functions';
import {createVercelHandler} from '../server/vercel-entry.mjs';

const fetch=createVercelHandler(process.env,{waitUntil});
export default {fetch};
