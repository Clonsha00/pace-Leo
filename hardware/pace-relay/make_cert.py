"""Generate a local CA and short-lived LAN certificate. Never share private keys."""
import argparse, datetime, ipaddress
from pathlib import Path
from cryptography import x509
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

parser=argparse.ArgumentParser()
parser.add_argument('ips',nargs='+',help='Computer LAN IPv4 address(es)')
args=parser.parse_args()
ips=[ipaddress.ip_address(value) for value in args.ips]
folder=Path(__file__).parent/'.local'
folder.mkdir(exist_ok=True)
ca_file=folder/'ca.pem'
key_file=folder/'ca-key.pem'
now=datetime.datetime.now(datetime.timezone.utc)
def save_key(path,key):
    path.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
if ca_file.exists() and key_file.exists():
    ca=x509.load_pem_x509_certificate(ca_file.read_bytes())
    ca_key=serialization.load_pem_private_key(key_file.read_bytes(),password=None)
else:
    ca_key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'PACE Local Test CA')])
    ca=(x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(days=1))
        .not_valid_after(now+datetime.timedelta(days=365)).add_extension(x509.BasicConstraints(ca=True,path_length=0),critical=True)
        .add_extension(x509.KeyUsage(False,False,False,False,False,True,True,False,False),critical=True)
        .sign(ca_key,hashes.SHA256()))
    save_key(key_file,ca_key)
    ca_file.write_bytes(ca.public_bytes(serialization.Encoding.PEM))
(folder/'lan-ca.cer').write_bytes(ca.public_bytes(serialization.Encoding.DER))
key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
cert=(x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'PACE LAN')]))
    .issuer_name(ca.subject).public_key(key.public_key()).serial_number(x509.random_serial_number())
    .not_valid_before(now-datetime.timedelta(days=1)).not_valid_after(now+datetime.timedelta(days=30))
    .add_extension(x509.BasicConstraints(ca=False,path_length=None),critical=True)
    .add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'),x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]+[x509.IPAddress(ip) for ip in ips]),critical=False)
    .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),critical=False)
    .sign(ca_key,hashes.SHA256()))
save_key(folder/'server-key.pem',key)
(folder/'server.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
print('Created LAN certificate for: '+', '.join(map(str,ips)))
