// GST state list (name -> GST state code). Delhi and Uttar Pradesh are kept on top, rest follow in code order.
export const STATES = [
  ['DELHI', '07'],
  ['UTTAR PRADESH', '09'],
  ['JAMMU & KASHMIR', '01'],
  ['HIMACHAL PRADESH', '02'],
  ['PUNJAB', '03'],
  ['CHANDIGARH', '04'],
  ['UTTARAKHAND', '05'],
  ['HARYANA', '06'],
  ['RAJASTHAN', '08'],
  ['BIHAR', '10'],
  ['SIKKIM', '11'],
  ['ARUNACHAL PRADESH', '12'],
  ['NAGALAND', '13'],
  ['MANIPUR', '14'],
  ['MIZORAM', '15'],
  ['TRIPURA', '16'],
  ['MEGHALAYA', '17'],
  ['ASSAM', '18'],
  ['WEST BENGAL', '19'],
  ['JHARKHAND', '20'],
  ['ODISHA', '21'],
  ['CHHATTISGARH', '22'],
  ['MADHYA PRADESH', '23'],
  ['GUJARAT', '24'],
  ['DADRA & NAGAR HAVELI AND DAMAN & DIU', '26'],
  ['MAHARASHTRA', '27'],
  ['ANDHRA PRADESH', '37'],
  ['KARNATAKA', '29'],
  ['GOA', '30'],
  ['LAKSHADWEEP', '31'],
  ['KERALA', '32'],
  ['TAMIL NADU', '33'],
  ['PUDUCHERRY', '34'],
  ['ANDAMAN & NICOBAR ISLANDS', '35'],
  ['TELANGANA', '36'],
  ['LADAKH', '38'],
];
export const STATE_NAMES = STATES.map(([n]) => n);
export const stateCodeFor = (name) => {
  const k = String(name || '').trim().toUpperCase();
  const hit = STATES.find(([n]) => n === k);
  return hit ? hit[1] : '';
};
