const React=require('react'),RDS=require('react-dom/server'),sharp=require('sharp');
const fi=require('react-icons/fi');
module.exports=async function icon(name,color='#FFFFFF',size=256){
  const svg=RDS.renderToStaticMarkup(React.createElement(fi[name],{color,size,strokeWidth:1.5}));
  const buf=await sharp(Buffer.from(svg)).png().toBuffer();
  return 'image/png;base64,'+buf.toString('base64');
}
