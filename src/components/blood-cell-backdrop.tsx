export default function BloodCellBackdrop() {
  return (
    <div className="blood-scene" aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => (
        <span className="blood-cell" key={index} />
      ))}
    </div>
  );
}
